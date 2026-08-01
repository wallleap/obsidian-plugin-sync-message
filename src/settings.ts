import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
import ObSyncPlugin from './main';

export interface ObSyncSettings {
	userId: string;
	saveFolder: string;
	lastSyncTime: string;
	lastSyncMessageId: string;
	attachmentFolder: string;
	imageFolder: string;
	timeFormat: string;
	titleTemplate: string;
	frontmatterTemplate: string;
	serverUrl: string;
	lastUpdateCheck: string;
	autoUpdate: boolean;
	// 文本消息笔记文件的组织粒度：day = 2026-07-31.md，month = 2026-07.md
	noteFileUnit: 'day' | 'month';
}

export const DEFAULT_SETTINGS: ObSyncSettings = {
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
	serverUrl: 'http://localhost:8080',
	lastUpdateCheck: '',
	autoUpdate: true,
	noteFileUnit: 'day',
};

export class ObSyncSettingTab extends PluginSettingTab {
	plugin: ObSyncPlugin;

	constructor(app: App, plugin: ObSyncPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName('Server URL')
			.setDesc('The URL of the ob sync server')
			.addText((text) =>
				text
					.setPlaceholder('HTTP://localhost:8080')
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
			.setName('Save folder')
			.setDesc('Folder to save synced notes')
			.addText((text) =>
				text
					.setPlaceholder('Ob sync')
					.setValue(this.plugin.settings.saveFolder)
					.onChange(async (value) => {
						this.plugin.settings.saveFolder = value;
						await this.plugin.saveSettings();
					}),
			);

		// 动态示例：显示当前日期/月份，随打开设置页的时间变化
		const now = new Date();
		const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
		const monthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

		new Setting(containerEl)
			.setName('Text note file unit')
			.setDesc(`Text messages are saved into one file per day (${todayStr}.md) or per month (${monthStr}.md)`)
			.addDropdown((dropdown) =>
				dropdown
					.addOption('day', `Daily (${todayStr}.md)`)
					.addOption('month', `Monthly (${monthStr}.md)`)
					.setValue(this.plugin.settings.noteFileUnit)
					.onChange(async (value) => {
						this.plugin.settings.noteFileUnit = value as 'day' | 'month';
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('Attachment folder')
			.setDesc('Subfolder for attachments (relative to save folder)')
			.addText((text) =>
				text
					.setPlaceholder('Attachments')
					.setValue(this.plugin.settings.attachmentFolder)
					.onChange(async (value) => {
						this.plugin.settings.attachmentFolder = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('Image folder')
			.setDesc('Subfolder for images (relative to save folder)')
			.addText((text) =>
				text
					.setPlaceholder('Images')
					.setValue(this.plugin.settings.imageFolder)
					.onChange(async (value) => {
						this.plugin.settings.imageFolder = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('Time format')
			.setDesc('Format for timestamps in notes')
			.addText((text) =>
				text
					.setPlaceholder('Yyyy-mm-dd hh:mm:ss')
					.setValue(this.plugin.settings.timeFormat)
					.onChange(async (value) => {
						this.plugin.settings.timeFormat = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('Title template')
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
			.setName('Frontmatter template')
			.setDesc('Template for YAML frontmatter. Use {{title}}, {{created_at}}, {{url}}')
			.addTextArea((text) =>
				text
					.setPlaceholder('title: {{title}}\ndate: {{created_at}}')
					.setValue(this.plugin.settings.frontmatterTemplate)
					.onChange(async (value) => {
						this.plugin.settings.frontmatterTemplate = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('Auto update')
			.setDesc('Automatically check for plugin updates on startup')
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.autoUpdate)
					.onChange(async (value) => {
						this.plugin.settings.autoUpdate = value;
						await this.plugin.saveSettings();
					}),
			);

		// Update section
		new Setting(containerEl)
			.setName('Plugin update')
			.setDesc('Check for and install plugin updates')
			.addButton((button) => {
				button.setButtonText('Check');
				button.onClick(async () => {
					button.setButtonText('Checking...');
					button.setDisabled(true);
					
					try {
						const latestRelease = await (this.plugin as unknown as { fetchLatestVersion: () => Promise<unknown> }).fetchLatestVersion();
						if (!latestRelease) {
							new Notice('Failed to fetch latest release');
							button.setButtonText('Check');
							button.setDisabled(false);
							return;
						}

						const plugin = this.plugin as unknown as {
							currentVersion: string;
							compareVersions: (v1: string, v2: string) => number;
							downloadAndInstallUpdate: (release: unknown) => Promise<void>;
						};
						
						const latestVersion = (latestRelease as { tag_name: string }).tag_name.replace(/^v/, '');
						const currentVersion = plugin.currentVersion.replace(/^v/, '');
						
						if (plugin.compareVersions(latestVersion, currentVersion) > 0) {
							new Notice(`Update available: ${currentVersion} → ${latestVersion}`, 5000);
							const downloadNotice = new Notice('Downloading update...', 0);
							plugin.downloadAndInstallUpdate(latestRelease).then(() => {
								downloadNotice.hide();
								new Notice('Update downloaded! Please restart Obsidian to complete the update.', 15000);
							}).catch((error) => {
								downloadNotice.hide();
								console.error('[OB Sync] Error downloading update:', error);
								new Notice('Failed to download update');
							});
						} else {
							new Notice(`No update available. You are already on the latest version (${currentVersion})`);
						}
						
						button.setButtonText('Check');
						button.setDisabled(false);
					} catch (error) {
						console.error('[OB Sync] Error checking for updates:', error);
						new Notice('Failed to check for updates');
						button.setButtonText('Check');
						button.setDisabled(false);
					}
				});
			});

		const versionDiv = containerEl.createEl('div', { cls: 'setting-item-description' });
		const versionP = versionDiv.createEl('p');
		versionP.createEl('strong', { text: 'Current version: ' });
		versionP.createEl('span', { text: this.plugin.currentVersion });

		const lastSyncDiv = containerEl.createEl('div', { cls: 'setting-item-description' });
		const lastSyncP = lastSyncDiv.createEl('p');
		lastSyncP.createEl('strong', { text: 'Last sync time: ' });
		const lastSyncSpan = lastSyncP.createEl('span', { attr: { id: 'last-sync-time' } });
		lastSyncSpan.setText(this.plugin.settings.lastSyncTime ? new Date(this.plugin.settings.lastSyncTime).toLocaleString() : 'Never synced');

		// Add a sync button in settings
		new Setting(containerEl)
			.setName('Sync now')
			.setDesc('Manually trigger a sync')
			.addButton((button) =>
				button
					.setButtonText('Sync')
					.onClick(async () => {
						await this.plugin.syncMessages();
						// Refresh the display
						const timeEl = activeDocument.getElementById('last-sync-time');
						if (timeEl) {
							timeEl.textContent = this.plugin.settings.lastSyncTime
								? new Date(this.plugin.settings.lastSyncTime).toLocaleString()
								: 'Never synced';
						}
					}),
			);
	}
}
