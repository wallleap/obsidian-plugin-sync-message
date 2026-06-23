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
	id: number;
	type: string;
	title: string;
	content: string;
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
		const fileName = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}.md`;
		const filePath = `${this.settings.saveFolder}/${fileName}`;

		const abstractFile = this.app.vault.getAbstractFileByPath(filePath);
		let file: TFile;
		if (abstractFile instanceof TFile) {
			file = abstractFile;
		} else {
			file = await this.app.vault.create(filePath, '');
		}

		const existingContent = await this.app.vault.read(file);
		const timeStr = this.formatTime(date);
		const newContent = `${existingContent}## ${timeStr}\n\n${message.content}\n\n`;

		await this.app.vault.modify(file, newContent);
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

		let frontmatter = this.settings.frontmatterTemplate
			.replace(/\{\{title\}\}/g, message.title || '')
			.replace(/\{\{created_at\}\}/g, datetimeStr)
			.replace(/\{\{url\}\}/g, message.original_url || '')
			.replace(/\{\{date\}\}/g, dateStr)
			.replace(/\{\{time\}\}/g, timeStr);

		return frontmatter;
	}

	renderContent(title: string, message: Message, date: Date, frontmatter: string): string {
		if (frontmatter) {
			return `---\n${frontmatter}\n---\n\n${message.content || ''}`;
		}

		return `# ${title}\n\n**URL:** [${message.original_url}](${message.original_url})\n\n**Saved:** ${this.formatDate(date)} ${this.formatTime(date)}\n\n${message.content || ''}`;
	}

	async downloadAttachment(message: Message) {
		if (!message.attachment) return;

		const attachmentFolder = `${this.settings.saveFolder}/${this.settings.attachmentFolder}`;
		await this.ensureFolderExists(attachmentFolder);

		try {
			const response = await requestUrl({
				url: `${this.settings.serverUrl.replace(/\/$/, '')}/api/message/file/${message.id}`,
				method: 'GET',
			});

			const arrayBuffer = response.arrayBuffer;

			const fileName = message.attachment.filename;
			const filePath = `${attachmentFolder}/${fileName}`;

			await this.app.vault.createBinary(filePath, arrayBuffer);

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
			const newContent = `${existingContent}- [${fileName}](/${filePath}) (${this.formatDate(date)})\n`;

			await this.app.vault.modify(note, newContent);
		} catch {
			// Failed to download attachment
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
		try {
			const latestRelease = await this.fetchLatestVersion();
			if (!latestRelease) {
				if (showNoUpdateNotice) {
					new Notice('Failed to check for updates');
				}
				return;
			}

			const latestVersion = latestRelease.tag_name.replace(/^v/, '');
			const currentVersion = this.currentVersion.replace(/^v/, '');

			if (this.compareVersions(latestVersion, currentVersion) > 0) {
				const notice = new Notice(`Update available: ${currentVersion} → ${latestVersion}`, 10000);
				const el = ((notice as unknown as { messageEl?: HTMLElement }).messageEl
					?? (notice as unknown as { noticeEl?: HTMLElement }).noticeEl);
				el?.addEventListener('click', () => {
					void this.downloadAndInstallUpdate(latestRelease);
				});
			} else if (showNoUpdateNotice) {
				new Notice('No updates available');
			}

			this.settings.lastUpdateCheck = new Date().toISOString();
			await this.saveSettings();
		} catch (error) {
			console.error('Error checking for updates:', error);
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
			return response.json as GitHubRelease;
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
		const notice = new Notice('Downloading update...');

		try {
			const pluginDir = this.getPluginDirectory();
			if (!pluginDir) {
				new Notice('Failed to find plugin directory');
				notice.hide();
				return;
			}

			const requiredFiles = ['main.js', 'manifest.json', 'styles.css'];
			const assets = release.assets;

			for (const fileName of requiredFiles) {
				const asset = assets.find(a => a.name === fileName);
				if (!asset) {
					console.warn(`Missing asset: ${fileName}`);
					continue;
				}

				const response = await requestUrl({
					url: asset.browser_download_url,
					method: 'GET',
				});

				const filePath = `${pluginDir}/${fileName}`;
				if (response.arrayBuffer) {
					await this.app.vault.adapter.writeBinary(filePath, response.arrayBuffer);
				} else if (typeof response.text === 'string') {
					await this.app.vault.adapter.write(filePath, response.text);
				}
			}

			notice.hide();
			new Notice('Update downloaded! Please restart Obsidian to complete the update.', 15000);
		} catch (error) {
			console.error('Error downloading update:', error);
			notice.hide();
			new Notice('Failed to download update');
		}
	}

	getPluginDirectory(): string | null {
		try {
			const pluginId = (this.manifest as { id?: string })?.id || 'ob-sync';
			const adapter = (this.app.vault as unknown as { adapter?: { basePath?: string } }).adapter;
			const vaultDir = adapter?.basePath;
			if (vaultDir) {
				return `${vaultDir}/.obsidian/plugins/${pluginId}`;
			}
			return null;
		} catch {
			return null;
		}
	}
}
