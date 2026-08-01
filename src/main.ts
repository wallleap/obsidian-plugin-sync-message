import {
	Notice,
	Plugin,
	TFile,
	requestUrl,
} from 'obsidian';
import {
	DEFAULT_SETTINGS,
	ObSyncSettings,
	ObSyncSettingTab,
} from './settings';

export interface Message {
	id: string;
	type: string;
	title: string;
	content: string;
	summary?: string;
	summary_status?: string;
	original_url: string;
	file_path: string;
	created_at: string;
	attachment?: {
		filename: string;
		file_type: string;
	};
}

interface GitHubRelease {
	tag_name: string;
	assets: Array<{
		name: string;
		browser_download_url: string;
	}>;
}

export default class ObSyncPlugin extends Plugin {
	settings!: ObSyncSettings;
	currentVersion: string = '0.0.0';
	latestRelease: GitHubRelease | null = null;

	async onload() {
		await this.loadSettings();

		this.currentVersion = (this.manifest as { version?: string })?.version || '0.0.0';

		this.addRibbonIcon('refresh-cw', 'Ob sync', async (_evt: MouseEvent) => {
			await this.syncMessages();
		});

		this.addCommand({
			id: 'sync',
			name: 'Sync messages',
			callback: async () => {
				await this.syncMessages();
			},
		});

		this.addCommand({
			id: 'open-settings',
			name: 'Open settings',
			callback: () => {
				(this.app as unknown as { setting: { open: () => void } }).setting.open();
			},
		});

		this.addCommand({
			id: 'check-update',
			name: 'Check for updates',
			callback: async () => {
				await this.checkForUpdates(true);
			},
		});

		this.addCommand({
			id: 'download-update',
			name: 'Download and install update',
			callback: async () => {
				console.debug('[OB Sync] Manual update command triggered');
				const latestRelease = await this.fetchLatestVersion();
				if (latestRelease) {
					await this.downloadAndInstallUpdate(latestRelease);
				} else {
					new Notice('Failed to fetch latest release');
				}
			},
		});

		this.addSettingTab(new ObSyncSettingTab(this.app, this));

		if (this.settings.autoUpdate) {
			this.register(() => {});
			window.setTimeout(() => {
				void this.checkForUpdates(false);
			}, 5000);
		}
	}

	onunload() { }

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData() as Partial<ObSyncSettings>,
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	async syncMessages() {
		if (!this.settings.userId) {
			new Notice('Please set your user ID in settings');
			return;
		}

		const notice = new Notice('Syncing messages...');

		try {
			const response = await requestUrl({
				url: `${this.settings.serverUrl.replace(/\/$/, '')}/api/message/sync`,
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({
					user_id: this.settings.userId,
					last_sync_time: this.settings.lastSyncTime,
					last_sync_message_id: this.settings.lastSyncMessageId,
				}),
			});

			let messages = response.json as Message[];

			if (messages.length === 0) {
				notice.hide();
				new Notice('No new messages to sync');
				return;
			}

			if (this.settings.lastSyncMessageId) {
				const syncedIds = new Set<string>();
				syncedIds.add(this.settings.lastSyncMessageId);
				messages = messages.filter(msg => !syncedIds.has(String(msg.id)));
			}

			if (messages.length === 0) {
				notice.hide();
				new Notice('No new messages to sync');
				return;
			}

			for (const message of messages) {
				await this.processMessage(message);
			}

			const latestMessage = messages[messages.length - 1];
			if (latestMessage) {
				this.settings.lastSyncMessageId = String(latestMessage.id);
				if (latestMessage.created_at) {
					this.settings.lastSyncTime = latestMessage.created_at;
				} else {
					this.settings.lastSyncTime = new Date().toISOString();
				}
			}
			await this.saveSettings();

			notice.hide();
			new Notice(`Synced ${messages.length} message(s)`);
		} catch (error) {
			notice.hide();
			new Notice('Sync failed: ' + (error as Error).message);
		}
	}

	async processMessage(message: Message) {
		await this.ensureFolderExists(this.settings.saveFolder);

		switch (message.type) {
			case 'text':
				await this.createTextNote(message);
				break;
			case 'url':
				await this.createUrlNote(message);
				break;
			case 'attachment':
				await this.downloadAttachment(message);
				break;
			default:
				await this.createTextNote(message);
		}
	}

	async ensureFolderExists(folderPath: string): Promise<void> {
		const folder = this.app.vault.getAbstractFileByPath(folderPath);
		if (!folder) {
			await this.app.vault.createFolder(folderPath);
		}
	}

	async createTextNote(message: Message) {
		const date = new Date(message.created_at);
		const fileName = this.getTextNoteFileName(date);
		const filePath = `${this.settings.saveFolder}/${fileName}`;

		const abstractFile = this.app.vault.getAbstractFileByPath(filePath);
		let file: TFile;
		if (abstractFile instanceof TFile) {
			file = abstractFile;
		} else {
			file = await this.app.vault.create(filePath, '');
		}

		const existingContent = await this.app.vault.read(file);
		const header = this.getTextNoteHeader(date);

		// 带附件（text + 附件一起发送）：下载附件，文本 md 写入 embed/链接，同时记录到 attachments.md
		let attLine = '';
		if (message.attachment) {
			const savedPath = await this.downloadAttachmentFile(message);
			if (savedPath) {
				attLine = this.isImageFileType(message.attachment.file_type)
					? `![[${savedPath}]]\n\n`
					: `[${message.attachment.filename}](/${savedPath})\n\n`;
				await this.appendToAttachmentsMD(message, savedPath);
			}
		}

		const newContent = `${existingContent}## ${header}\n\n${message.content || ''}\n\n${attLine}`;

		await this.app.vault.modify(file, newContent);
	}

	// 判断附件是否为图片（兼容完整 MIME 与旧版大类）
	isImageFileType(fileType: string): boolean {
		return fileType === 'image' || fileType.startsWith('image/');
	}

	// 文本消息笔记文件名：按设置按天（2026-07-31.md）或按月（2026-07.md）组织
	getTextNoteFileName(date: Date): string {
		const year = date.getFullYear();
		const month = String(date.getMonth() + 1).padStart(2, '0');
		if (this.settings.noteFileUnit === 'month') {
			return `${year}-${month}.md`;
		}
		const day = String(date.getDate()).padStart(2, '0');
		return `${year}-${month}-${day}.md`;
	}

	// 文本消息内容标题：按天文件只写时间（HH:mm:ss，文件名已含日期）；
	// 按月文件写日期时间（YYYY-MM-DD HH:mm:ss，便于在同月文件里区分）。
	getTextNoteHeader(date: Date): string {
		const time = this.formatTime(date);
		if (this.settings.noteFileUnit === 'month') {
			return `${this.formatDate(date)} ${time}`;
		}
		return time;
	}

	async createUrlNote(message: Message) {
		const date = new Date(message.created_at);
		const title = message.title || this.extractTitle(message.original_url) || 'Link';

		const sanitizedFileName = this.sanitizeFileName(title, `Link_${date.getTime()}`);
		const fileName = `${sanitizedFileName}.md`;
		const filePath = `${this.settings.saveFolder}/${fileName}`;

		const frontmatter = this.renderFrontmatter(message, date);
		const content = this.renderContent(title, message, date, frontmatter);

		try {
			const abstractFile = this.app.vault.getAbstractFileByPath(filePath);
			if (abstractFile instanceof TFile) {
				await this.app.vault.modify(abstractFile, content);
			} else {
				await this.app.vault.create(filePath, content);
			}
		} catch (error) {
			new Notice(`Failed to create note: ${(error as Error).message}`);
		}
	}

	renderFrontmatter(message: Message, date: Date): string {
		if (!this.settings.frontmatterTemplate || this.settings.frontmatterTemplate.trim() === '') {
			return '';
		}

		const dateStr = this.formatDate(date);
		const timeStr = this.formatTime(date);
		const datetimeStr = `${dateStr} ${timeStr}`;

		// summary 多行文本在 YAML 里需单行化，避免破坏 frontmatter 语法
		const summarySingleLine = (message.summary || '').replace(/\s+/g, ' ').trim();

		let frontmatter = this.settings.frontmatterTemplate
			.replace(/\{\{title\}\}/g, message.title || '')
			.replace(/\{\{created_at\}\}/g, datetimeStr)
			.replace(/\{\{url\}\}/g, message.original_url || '')
			.replace(/\{\{date\}\}/g, dateStr)
			.replace(/\{\{time\}\}/g, timeStr)
			.replace(/\{\{summary\}\}/g, summarySingleLine);

		return frontmatter;
	}

	renderContent(title: string, message: Message, date: Date, frontmatter: string): string {
		// AI 摘要以 Obsidian callout 形式展示在正文前（仅生成成功时）
		const summaryBlock = message.summary ? this.renderSummaryBlock(message.summary) : '';
		const body = summaryBlock
			? `${summaryBlock}\n\n${message.content || ''}`
			: (message.content || '');

		if (frontmatter) {
			return `---\n${frontmatter}\n---\n\n${body}`;
		}

		return `# ${title}\n\n**URL:** [${message.original_url}](${message.original_url})\n\n**Saved:** ${this.formatDate(date)} ${this.formatTime(date)}\n\n${body}`;
	}

	// 摘要转 Obsidian callout：每行加 > 前缀，多行 Markdown 摘要保持可读
	renderSummaryBlock(summary: string): string {
		const lines = summary.split('\n').map((line) => `> ${line}`);
		return `> [!summary] 📌 AI 摘要\n${lines.join('\n')}`;
	}

	async downloadAttachment(message: Message) {
		if (!message.attachment) return;

		const savedPath = await this.downloadAttachmentFile(message);
		if (!savedPath) {
			return; // 下载失败，静默（downloadAttachmentFile 内已有处理）
		}

		await this.appendToAttachmentsMD(message, savedPath);
	}

	// 在 attachments.md 追加附件记录（图片 embed / 其它附件链接）
	async appendToAttachmentsMD(message: Message, savedPath: string) {
		const date = new Date(message.created_at);
		const notePath = `${this.settings.saveFolder}/attachments.md`;

		const abstractFile = this.app.vault.getAbstractFileByPath(notePath);
		let note: TFile;
		if (abstractFile instanceof TFile) {
			note = abstractFile;
		} else {
			note = await this.app.vault.create(notePath, '# Attachments\n\n');
		}

		const existingContent = await this.app.vault.read(note);
		const link = this.isImageFileType(message.attachment.file_type)
			? `![[${savedPath}]]`
			: `[${message.attachment.filename}](/${savedPath})`;
		const newContent = `${existingContent}- ${link} (${this.formatDate(date)})\n`;

		await this.app.vault.modify(note, newContent);
	}

	// 下载附件到对应目录（图片 imageFolder，其它 attachmentFolder），返回 vault 路径；失败返回 null。
	async downloadAttachmentFile(message: Message): Promise<string | null> {
		if (!message.attachment) return null;

		const subFolder = this.isImageFileType(message.attachment.file_type)
			? this.settings.imageFolder
			: this.settings.attachmentFolder;
		const targetFolder = `${this.settings.saveFolder}/${subFolder}`;
		await this.ensureFolderExists(targetFolder);

		try {
			const response = await requestUrl({
				url: `${this.settings.serverUrl.replace(/\/$/, '')}/api/message/file/${message.id}`,
				method: 'GET',
			});

			const fileName = message.attachment.filename;
			const filePath = `${targetFolder}/${fileName}`;
			await this.app.vault.createBinary(filePath, response.arrayBuffer);
			return filePath;
		} catch {
			return null; // 下载失败
		}
	}

	formatDate(date: Date): string {
		const year = date.getFullYear();
		const month = String(date.getMonth() + 1).padStart(2, '0');
		const day = String(date.getDate()).padStart(2, '0');
		return `${year}-${month}-${day}`;
	}

	formatTime(date: Date): string {
		const hours = String(date.getHours()).padStart(2, '0');
		const minutes = String(date.getMinutes()).padStart(2, '0');
		const seconds = String(date.getSeconds()).padStart(2, '0');
		return `${hours}:${minutes}:${seconds}`;
	}

	extractTitle(url: string): string | null {
		try {
			const parsedUrl = new URL(url);
			const pathParts = parsedUrl.pathname.split('/').filter(Boolean);
			if (pathParts.length > 0) {
				const lastPart = pathParts[pathParts.length - 1];
				if (lastPart) {
					return lastPart.replace(/\.[^.]+$/, '').replace(/-/g, ' ');
				}
			}
			return parsedUrl.hostname;
		} catch {
			return null;
		}
	}

	sanitizeFileName(title: string, fallback: string = 'Link'): string {
		if (!title || title.trim().length === 0) {
			return fallback;
		}

		let fileName = title.trim();

		const invalidChars = /[\\/:*?"<>|]/g;
		fileName = fileName.replace(invalidChars, '_');

		fileName = fileName.replace(/\s+/g, '_');

		fileName = fileName.replace(/_+/g, '_');

		fileName = fileName.replace(/^_|_$/g, '');

		const maxLength = 100;
		if (fileName.length > maxLength) {
			fileName = fileName.substring(0, maxLength);
		}

		if (fileName.length === 0) {
			return fallback;
		}

		return fileName;
	}

	async checkForUpdates(showNoUpdateNotice: boolean = false): Promise<void> {
		console.debug('[OB Sync] Checking for updates...');
		try {
			const latestRelease = await this.fetchLatestVersion();
			if (!latestRelease) {
				console.debug('[OB Sync] Failed to fetch latest release from GitHub');
				if (showNoUpdateNotice) {
					new Notice('Failed to check for updates');
				}
				return;
			}

			const latestVersion = latestRelease.tag_name.replace(/^v/, '');
			const currentVersion = this.currentVersion.replace(/^v/, '');

			console.debug(`[OB Sync] Current version: ${currentVersion}`);
			console.debug(`[OB Sync] Latest version: ${latestVersion}`);

			if (this.compareVersions(latestVersion, currentVersion) > 0) {
				console.debug(`[OB Sync] Update available: ${currentVersion} → ${latestVersion}`);
				try {
					const notice = new Notice(`Update available: ${currentVersion} → ${latestVersion}`, 15000);
					console.debug('[OB Sync] Notice created with 15s duration');
					
					const noticeAsAny = notice as { messageEl?: HTMLElement; noticeEl?: HTMLElement; containerEl?: HTMLElement };
					console.debug(`[OB Sync] Notice has messageEl: ${noticeAsAny.messageEl ? 'yes' : 'no'}`);
					console.debug(`[OB Sync] Notice has noticeEl: ${noticeAsAny.noticeEl ? 'yes' : 'no'}`);
					console.debug(`[OB Sync] Notice has containerEl: ${noticeAsAny.containerEl ? 'yes' : 'no'}`);
					
					const el = noticeAsAny.messageEl || noticeAsAny.noticeEl || noticeAsAny.containerEl;
					console.debug(`[OB Sync] Notice element: ${el ? 'found' : 'not found'}`);
					
					if (el) {
						console.debug(`[OB Sync] Element tag: ${el.tagName}`);
						const clickHandler = () => {
							console.debug('[OB Sync] Notice clicked! Starting download...');
							void this.downloadAndInstallUpdate(latestRelease);
						};
						el.addEventListener('click', clickHandler);
						console.debug('[OB Sync] Click event listener added successfully');
					} else {
						console.debug('[OB Sync] Cannot add click listener, all elements are null');
						console.debug('[OB Sync] Suggesting user to use command to update');
					}
				} catch (e) {
					console.error('[OB Sync] Error creating notice or adding click listener:', e);
				}
			} else {
				console.debug('[OB Sync] No updates available, already on latest version');
				if (showNoUpdateNotice) {
					new Notice('No updates available');
				}
			}

			this.settings.lastUpdateCheck = new Date().toISOString();
			await this.saveSettings();
			console.debug('[OB Sync] Update check completed');
		} catch (error) {
			console.error('[OB Sync] Error checking for updates:', error);
			if (showNoUpdateNotice) {
				new Notice('Failed to check for updates');
			}
		}
	}

	async fetchLatestVersion(): Promise<GitHubRelease | null> {
		try {
			const response = await requestUrl({
				url: 'https://api.github.com/repos/wallleap/obsidian-plugin-sync-message/releases/latest',
				method: 'GET',
				headers: {
					'Accept': 'application/vnd.github.v3+json',
				},
			});
			this.latestRelease = response.json as GitHubRelease;
			return this.latestRelease;
		} catch {
			return null;
		}
	}

	compareVersions(v1: string, v2: string): number {
		const parts1 = v1.split('.').map(Number);
		const parts2 = v2.split('.').map(Number);
		const length = Math.max(parts1.length, parts2.length);

		for (let i = 0; i < length; i++) {
			const p1 = parts1[i] || 0;
			const p2 = parts2[i] || 0;
			if (p1 > p2) return 1;
			if (p1 < p2) return -1;
		}
		return 0;
	}

	async downloadAndInstallUpdate(release: GitHubRelease): Promise<void> {
		console.debug(`[OB Sync] Starting download for version ${release.tag_name}`);
		const notice = new Notice('Downloading update...');

		try {
			const pluginId = (this.manifest as { id?: string })?.id || 'ob-sync';
			const pluginDir = `.obsidian/plugins/${pluginId}`;
			console.debug(`[OB Sync] Plugin directory (relative): ${pluginDir}`);

			const requiredFiles = ['main.js', 'manifest.json', 'styles.css'];
			const assets = release.assets;

			for (const fileName of requiredFiles) {
				const asset = assets.find(a => a.name === fileName);
				if (!asset) {
					console.debug(`[OB Sync] Missing asset: ${fileName}`);
					continue;
				}

				console.debug(`[OB Sync] Downloading ${fileName} from ${asset.browser_download_url}`);
				const response = await requestUrl({
					url: asset.browser_download_url,
					method: 'GET',
				});

				const filePath = `${pluginDir}/${fileName}`;
				console.debug(`[OB Sync] Writing ${fileName} to ${filePath}`);
				
				if (response.arrayBuffer) {
					await this.app.vault.adapter.writeBinary(filePath, response.arrayBuffer);
				} else if (typeof response.text === 'string') {
					await this.app.vault.adapter.write(filePath, response.text);
				}
				console.debug(`[OB Sync] Successfully downloaded ${fileName}`);
			}

			console.debug(`[OB Sync] Update ${release.tag_name} downloaded successfully`);
			notice.hide();
			new Notice('Update downloaded! Please restart Obsidian to complete the update.', 15000);
		} catch (error) {
			console.error('[OB Sync] Error downloading update:', error);
			notice.hide();
			new Notice('Failed to download update');
		}
	}

	getPluginDirectory(): string | null {
		try {
			const pluginId = (this.manifest as { id?: string })?.id || 'ob-sync';
			console.debug(`[OB Sync] Plugin ID from manifest: ${pluginId}`);
			
			const vault = this.app.vault as unknown as { adapter?: { basePath?: string } };
			const adapter = vault.adapter;
			console.debug(`[OB Sync] Adapter available: ${adapter ? 'yes' : 'no'}`);
			
			const vaultDir = adapter?.basePath;
			console.debug(`[OB Sync] Vault directory: ${vaultDir || 'not found'}`);
			
			if (vaultDir) {
				const pluginDir = `${vaultDir}/.obsidian/plugins/${pluginId}`;
				console.debug(`[OB Sync] Plugin directory: ${pluginDir}`);
				return pluginDir;
			}
			console.debug('[OB Sync] Cannot get plugin directory: vaultDir is null');
			return null;
		} catch (e) {
			console.error('[OB Sync] Error getting plugin directory:', e);
			return null;
		}
	}
}
