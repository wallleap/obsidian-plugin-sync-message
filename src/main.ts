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

export default class ObSyncPlugin extends Plugin {
	settings!: ObSyncSettings;

	async onload() {
		await this.loadSettings();

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

		this.addSettingTab(new ObSyncSettingTab(this.app, this));
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
				url: `${this.settings.serverUrl}/api/message/sync`,
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
			const content = `# ${this.formatDate(date)}\n\n`;
			file = await this.app.vault.create(filePath, content);
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
				url: `${this.settings.serverUrl}/api/message/file/${message.id}`,
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
}
