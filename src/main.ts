import {
	Editor,
	MarkdownView,
	MarkdownFileInfo,
	Modal,
	Notice,
	Plugin,
	TFile,
} from 'obsidian';
import {
	DEFAULT_SETTINGS,
	MyPluginSettings,
	SampleSettingTab,
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

export default class MyPlugin extends Plugin {
	settings!: MyPluginSettings;

	async onload() {
		await this.loadSettings();

		this.addRibbonIcon('refresh-cw', 'OB Sync', async (_evt: MouseEvent) => {
			await this.syncMessages();
		});

		this.addCommand({
			id: 'ob-sync-sync',
			name: 'Sync Messages',
			callback: async () => {
				await this.syncMessages();
			},
		});

		this.addCommand({
			id: 'ob-sync-settings',
			name: 'Open Settings',
			callback: () => {
				// @ts-ignore - setting.open() not in type definitions
				this.app.setting.open();
			},
		});

		this.addSettingTab(new SampleSettingTab(this.app, this));
	}

	onunload() { }

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			(await this.loadData()) as Partial<MyPluginSettings>,
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	async syncMessages() {
		if (!this.settings.userId) {
			new Notice('Please set your User ID in settings');
			return;
		}

		const notice = new Notice('Syncing messages...');

		try {
			const response = await fetch(
				`${this.settings.serverUrl}/api/message/sync`,
				{
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
					},
					body: JSON.stringify({
						user_id: this.settings.userId,
						last_sync_time: this.settings.lastSyncTime,
					}),
				},
			);

			if (!response.ok) {
				throw new Error(`HTTP error! status: ${response.status}`);
			}

			let messages: Message[] = await response.json();

			if (messages.length === 0) {
				notice.hide();
				new Notice('No new messages to sync');
				return;
			}

			if (this.settings.lastSyncMessageId) {
				const syncedIds = new Set<string>();
				syncedIds.add(this.settings.lastSyncMessageId);
				messages = messages.filter(msg => !syncedIds.has(msg.id));
				console.log(`[OB Sync] Filtered out already synced messages`);
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
				this.settings.lastSyncMessageId = latestMessage.id;
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
			console.error('Sync failed:', error);
			new Notice('Sync failed: ' + (error as Error).message);
		}
	}

	async processMessage(message: Message) {
		console.log(`[OB Sync] Processing message: id=${message.id}, type="${message.type}", title="${message.title}", original_url="${message.original_url}"`);

		await this.ensureFolderExists(this.settings.saveFolder);

		switch (message.type) {
			case 'text':
				console.log(`[OB Sync] Message type is 'text', calling createTextNote`);
				await this.createTextNote(message);
				break;
			case 'url':
				console.log(`[OB Sync] Message type is 'url', calling createUrlNote`);
				await this.createUrlNote(message);
				break;
			case 'attachment':
				console.log(`[OB Sync] Message type is 'attachment', calling downloadAttachment`);
				await this.downloadAttachment(message);
				break;
			default:
				console.log(`[OB Sync] Message type is '${message.type}', calling createTextNote as default`);
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

		let file = this.app.vault.getAbstractFileByPath(filePath) as TFile;
		if (!file) {
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

		console.log(`[OB Sync] createUrlNote - message.title: "${message.title}", extracted title: "${title}", sanitized fileName: "${sanitizedFileName}", full filePath: "${filePath}"`);

		const frontmatter = this.renderFrontmatter(message, date);
		const content = this.renderContent(title, message, date, frontmatter);

		try {
			const existingFile = this.app.vault.getAbstractFileByPath(filePath) as TFile;
			if (existingFile) {
				console.log(`[OB Sync] File exists at "${filePath}", modifying content`);
				await this.app.vault.modify(existingFile, content);
			} else {
				console.log(`[OB Sync] File does not exist, creating new file at "${filePath}"`);
				await this.app.vault.create(filePath, content);
			}
			console.log(`[OB Sync] Successfully processed URL note: "${filePath}"`);
		} catch (error) {
			console.error(`[OB Sync] Failed to create/modify file:`, error);
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
			const response = await fetch(
				`${this.settings.serverUrl}/api/message/file/${message.id}`,
			);

			if (!response.ok) {
				throw new Error(`Failed to download attachment`);
			}

			const blob = await response.blob();
			const arrayBuffer = await blob.arrayBuffer();

			const fileName = message.attachment.filename;
			const filePath = `${attachmentFolder}/${fileName}`;

			await this.app.vault.createBinary(filePath, arrayBuffer);

			const date = new Date(message.created_at);
			const notePath = `${this.settings.saveFolder}/attachments.md`;

			let note = this.app.vault.getAbstractFileByPath(notePath) as TFile;
			if (!note) {
				note = await this.app.vault.create(notePath, '# Attachments\n\n');
			}

			const existingContent = await this.app.vault.read(note);
			const newContent = `${existingContent}- [${fileName}](/${filePath}) (${this.formatDate(date)})\n`;

			await this.app.vault.modify(note, newContent);
		} catch (error) {
			console.error('Failed to download attachment:', error);
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

class SampleModal extends Modal {
	onOpen() {
		const { contentEl } = this;
		contentEl.setText('OB Sync');
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}
