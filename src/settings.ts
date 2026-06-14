import { App, PluginSettingTab, Setting } from 'obsidian';
import MyPlugin from './main';

export interface MyPluginSettings {
	userId: string;
	saveFolder: string;
	lastSyncTime: string;
	lastSyncMessageId: string;
	attachmentFolder: string;
	imageFolder: string;
	timeFormat: string;
	titleTemplate: string;
	frontmatterTemplate: string;
	useImageBedRelay: boolean;
	serverUrl: string;
}

export const DEFAULT_SETTINGS: MyPluginSettings = {
	userId: '',
	saveFolder: 'ObSync',
	lastSyncTime: '',
	lastSyncMessageId: '',
	attachmentFolder: 'ObSync/attachments',
	imageFolder: 'ObSync/images',
	timeFormat: 'YYYY-MM-DD HH:mm:ss',
	titleTemplate: '{{title}}',
	frontmatterTemplate: `title: {{title}}
date: {{created_at}}
updated: {{created_at}}
image-auto-upload: true
source: {{url}}`,
	useImageBedRelay: false,
	serverUrl: 'http://localhost:8080',
};

export class SampleSettingTab extends PluginSettingTab {
	plugin: MyPlugin;

	constructor(app: App, plugin: MyPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		;

		new Setting(containerEl)
			.setName('Server URL')
			.setDesc('The URL of the OB Sync server')
			.addText((text) =>
				text
					.setPlaceholder('http://localhost:8080')
					.setValue(this.plugin.settings.serverUrl)
					.onChange(async (value) => {
						this.plugin.settings.serverUrl = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('User ID')
			.setDesc('Your unique user ID for synchronization')
			.addText((text) =>
				text
					.setPlaceholder('Enter your user ID')
					.setValue(this.plugin.settings.userId)
					.onChange(async (value) => {
						this.plugin.settings.userId = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('Save Folder')
			.setDesc('Folder to save synced notes')
			.addText((text) =>
				text
					.setPlaceholder('OB Sync')
					.setValue(this.plugin.settings.saveFolder)
					.onChange(async (value) => {
						this.plugin.settings.saveFolder = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('Attachment Folder')
			.setDesc('Subfolder for attachments (relative to save folder)')
			.addText((text) =>
				text
					.setPlaceholder('attachments')
					.setValue(this.plugin.settings.attachmentFolder)
					.onChange(async (value) => {
						this.plugin.settings.attachmentFolder = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('Image Folder')
			.setDesc('Subfolder for images (relative to save folder)')
			.addText((text) =>
				text
					.setPlaceholder('images')
					.setValue(this.plugin.settings.imageFolder)
					.onChange(async (value) => {
						this.plugin.settings.imageFolder = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('Time Format')
			.setDesc('Format for timestamps in notes')
			.addText((text) =>
				text
					.setPlaceholder('YYYY-MM-DD HH:mm:ss')
					.setValue(this.plugin.settings.timeFormat)
					.onChange(async (value) => {
						this.plugin.settings.timeFormat = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('Title Template')
			.setDesc('Template for note titles. Use {{title}}, {{date}}, {{time}}')
			.addText((text) =>
				text
					.setPlaceholder('{{title}}')
					.setValue(this.plugin.settings.titleTemplate)
					.onChange(async (value) => {
						this.plugin.settings.titleTemplate = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('Frontmatter Template')
			.setDesc('Template for YAML frontmatter. Use {{title}}, {{created_at}}, {{url}}')
			.addTextArea((text) =>
				text
					.setPlaceholder('title: {{title}}\ndate: {{created_at}}')
					.setValue(this.plugin.settings.frontmatterTemplate)
					.onChange(async (value) => {
						this.plugin.settings.frontmatterTemplate = value;
						await this.plugin.saveSettings();
					})
					.setRows(10),
			);

		new Setting(containerEl)
			.setName('Use Image Bed Relay')
			.setDesc('Enable image upload to image bed after downloading')
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.useImageBedRelay)
					.onChange(async (value) => {
						this.plugin.settings.useImageBedRelay = value;
						await this.plugin.saveSettings();
					}),
			);

		containerEl.createEl('div', { cls: 'setting-item-description' }).innerHTML =
			'<p><strong>Last Sync Time:</strong> <span id="last-sync-time">' +
			(this.plugin.settings.lastSyncTime ? new Date(this.plugin.settings.lastSyncTime).toLocaleString() : 'Never synced') +
			'</span></p>';

		// Add a sync button in settings
		new Setting(containerEl)
			.setName('Sync Now')
			.setDesc('Manually trigger a sync')
			.addButton((button) =>
				button
					.setButtonText('Sync')
					.onClick(async () => {
						await this.plugin.syncMessages();
						// Refresh the display
						const timeEl = document.getElementById('last-sync-time');
						if (timeEl) {
							timeEl.textContent = this.plugin.settings.lastSyncTime
								? new Date(this.plugin.settings.lastSyncTime).toLocaleString()
								: 'Never synced';
						}
					}),
			);
	}
}
