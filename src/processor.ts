import PQueue from 'p-queue';
import OpenAI from 'openai';
import { TFile, Notice, moment } from 'obsidian';
import { VoiceNotesSettings } from './types';
import VoiceNotesPlugin from 'main';

interface TranscriptionCandidate {
    path: string;
    isTranscribed: boolean;
    file?: TFile;
}

export class VoiceProcessor {
    private queue: PQueue;
    private openai: OpenAI;
    
    constructor(
        private plugin: VoiceNotesPlugin,
        private settings: VoiceNotesSettings
    ) {
        this.queue = new PQueue({ concurrency: 1 });
        this.openai = new OpenAI({
            apiKey: this.settings.openAIAPIKey,
            dangerouslyAllowBrowser: true
        });
    }

    async queueFile(file: TFile) {
        new Notice(`Processing audio file: ${file.path}`);
        this.queue.add(async () => {
            try {
                await this.processAudioFile(file);
                new Notice(`Transcribed: ${file.path}`);
            } catch (error) {
                new Notice(`Failed to process: ${file.path}`);
                console.error(error);
            }
        });
    }

    private async processAudioFile(file: TFile) {
        const formattedDate = moment(file.stat.mtime).format('YYYY-MM-DD');
        const formattedTime = moment(file.stat.mtime).format('HH.mm');
        const baseFileName = `${formattedDate} at ${formattedTime}`;
        const audioFileName = `${baseFileName}.${file.extension}`;

        // 1. Transcribe the audio
        const transcript = await this.transcribeAudio(file);

        // 2. Process with GPT-4
        const { summary, content } = await this.enhanceTranscript(transcript);

        // 3. Create markdown file with file's modification time
        const markdownContent = this.formatToMarkdown({
            summary,
            content,
            audioFileName,
            file
        });
        const outputPath = `${this.settings.outputDirectory}/${baseFileName}.md`;
        await this.plugin.app.vault.create(outputPath, markdownContent);

        // 4. Move original file to processed directory
        const processedDir = `${this.settings.processedDirectory}`;
        if (!this.plugin.app.vault.getFolderByPath(processedDir)) {
            await this.plugin.app.vault.createFolder(processedDir);
        }
        const targetLocation = `${processedDir}/${audioFileName}`;
        console.log(`Renaming ${file} to: ${targetLocation}`);
        await this.plugin.app.vault.rename(file, targetLocation);
    }

    private async transcribeAudio(file: TFile): Promise<string> {
        const audioData = await this.plugin.app.vault.readBinary(file);
        const blob = new Blob([audioData]);
        const audioFile = new File([blob], `audio.${file.extension}`, { type: `audio/${file.extension}` });

        const response = await this.openai.audio.transcriptions.create({
            file: audioFile,
            model: "whisper-1"
        });

        if (!response.text) {
            throw new Error('No transcription text received from OpenAI');
        }

        return response.text;
    }

    private async enhanceTranscript(transcript: string): Promise<{ summary: string, content: string }> {
        const response = await this.openai.chat.completions.create({
            model: "gpt-4",
            messages: [{
                role: "user",
                content: `I recorded this voice note recently. Please summarize it in the original language and from my perspective.
Start the summary with a short one-liner. Shorter is better.
Use a bullet list format, combining related items into single bullets as appropriate

${transcript}`}]
        });

        if (!response.choices[0].message.content) {
            throw new Error('No transcription text received from OpenAI');
        }

        const contentLines = response.choices[0].message.content.split('\n');
        return {
            summary: contentLines[0],
            content: contentLines.slice(1).join('\n')
        };
    }

    private formatToMarkdown({
        content,
        audioFileName,
        summary,
        file
    }: {
        content: string,
        audioFileName: string,
        summary: string,
        file: TFile
    }): string {
        const date = moment(file.stat.mtime).format('YYYY-MM-DD');
        const time = moment(file.stat.mtime).format('HH:mm');
        const template = `---
source: "[[${audioFileName}]]"
summary: "${summary}"
date: "${moment(file.stat.mtime).toISOString(true)}"
tags: 
  - fromvoicenote
---
${content}`;
        return template;
    }
}