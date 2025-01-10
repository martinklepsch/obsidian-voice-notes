import { App, Plugin, PluginSettingTab, Setting, TAbstractFile, TFile } from 'obsidian';
import { VoiceProcessor } from './processor';

interface VoiceNotesSettings {
	openAIAPIKey: string;
	watchDirectory: string;
	processedDirectory: string;
	outputDirectory: string;
}

const DEFAULT_SETTINGS: VoiceNotesSettings = {
	openAIAPIKey: '',
	watchDirectory: 'voice-notes',
	processedDirectory: 'voice-notes-processed',
	outputDirectory: 'voice-notes-output'
}

function isAudioFile(file: TFile): boolean {
	return file.extension === 'mp3' || file.extension === 'm4a';
}

function shouldProcessFile(settings: VoiceNotesSettings, file: TAbstractFile): boolean {
	return file.path.includes(settings.watchDirectory) 
		&& file instanceof TFile
		&& isAudioFile(file);
}

export default class VoiceNotesPlugin extends Plugin {
	settings: VoiceNotesSettings;
	processor: VoiceProcessor;

	async onload() {
		await this.loadSettings();
		this.processor = new VoiceProcessor(this, this.settings);

		// Give the app time to load in plugins and run its index check.
		this.app.workspace.onLayoutReady(async () => {
			console.log('ObsidianVoiceNotesPlugin: onload');

			if (!this.app.vault.getFolderByPath(this.settings.processedDirectory)) {
				await this.app.vault.createFolder(this.settings.processedDirectory);
			}

			if (!this.app.vault.getFolderByPath(this.settings.outputDirectory)) {
				await this.app.vault.createFolder(this.settings.outputDirectory);
			}

			this.queueUnprocessedFiles();

			// Then watch for any changes...
			const queueFromWatcher = async (file: TAbstractFile) => {
				if (shouldProcessFile(this.settings, file)) {
					this.processor.queueFile(file as TFile);
				}
			};

			this.registerEvent(this.app.vault.on("create", queueFromWatcher));
			this.registerEvent(this.app.vault.on("rename", queueFromWatcher));
		});

		this.addSettingTab(new VoiceNotesSettingTab(this.app, this));
	}

	async queueUnprocessedFiles() {
		const files = this.app.vault.getFiles();

		for (const file of files) {
			if (shouldProcessFile(this.settings, file)) {
				this.processor.queueFile(file as TFile);
			}
		}
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class VoiceNotesSettingTab extends PluginSettingTab {
	plugin: VoiceNotesPlugin;

	constructor(app: App, plugin: VoiceNotesPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName('OpenAI API Key')
			.setDesc('Enter your OpenAI API key')
			.addText(text => text
				.setPlaceholder('sk-...')
				.setValue(this.plugin.settings.openAIAPIKey)
				.onChange(async (value) => {
					this.plugin.settings.openAIAPIKey = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Watch Directory')
			.setDesc('Directory to watch for new audio files')
			.addText(text => text
				.setPlaceholder('voice-notes')
				.setValue(this.plugin.settings.watchDirectory)
				.onChange(async (value) => {
					this.plugin.settings.watchDirectory = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Processed Directory')
			.setDesc('Directory where processed files will be saved')
			.addText(text => text
				.setPlaceholder('voice-notes-processed')
				.setValue(this.plugin.settings.processedDirectory)
				.onChange(async (value) => {
					this.plugin.settings.processedDirectory = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Output Directory')
			.setDesc('Directory where transcribed files will be saved')
			.addText(text => text
				.setPlaceholder('voice-notes-processed')
				.setValue(this.plugin.settings.outputDirectory)
				.onChange(async (value) => {
					this.plugin.settings.outputDirectory = value;
					await this.plugin.saveSettings();
				}));
	}
}
