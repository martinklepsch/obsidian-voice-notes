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
        this.queue.add(async () => {
            try {
                new Notice(`Processing audio file: ${file.path}`);
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
        const processedDir = `${this.settings.processedDirectory}`;

        // 1. Transcribe the audio
        const transcript = await this.transcribeAudio(file);

        // 2. Process with GPT-4o
        const { summary, content } = await this.enhanceTranscript(transcript);

        // 3. Create markdown file with file's modification time
        const markdownContent = this.formatToMarkdown({
            summary,
            transcript,
            content,
            audioFileName,
            file
        });
        let outputPath = `${this.settings.outputDirectory}/${baseFileName}.md`;
        if (this.plugin.app.vault.getAbstractFileByPath(outputPath) !== null) {
            outputPath = `${this.settings.outputDirectory}/${baseFileName}_${Math.floor(Math.random() * 1000)}.md`;
        }
        await this.plugin.app.vault.create(outputPath, markdownContent);

        // 4. Move original file to processed directory
        let targetLocation = `${processedDir}/${audioFileName}`;
        if (this.plugin.app.vault.getAbstractFileByPath(targetLocation) !== null) {
            const randomSuffix = `_${Math.floor(Math.random() * 1000)}`;
            targetLocation = `${this.settings.processedDirectory}/${baseFileName}${randomSuffix}.${file.extension}`;
        }
        console.log(`Renaming ${file.name} to: ${targetLocation}`);
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
            model: "gpt-4o",
            messages: [
                {
                    role: "system",
                    content: `You are a helpful assistant that summarizes voice notes. 
You are writing in the original language of the voice note (either German or English).
You are writing as if you were the author of the voice note.
You are writing in the first person.`
                },
                {
                    role: "user",
                    content: `Please summarize this transcript.
Start with a specific summary of key points (up to 300 characters) followed by a bullet list of the content.

${transcript}`}]
        });

        if (!response.choices[0].message.content) {
            throw new Error('No transcription text received from OpenAI');
        }

        const contentLines = response.choices[0].message.content.split('\n');
        return {
            summary: contentLines[0],
            content: contentLines.slice(1).join('\n').trim()
        };
    }

    private formatToMarkdown({
        content,
        transcript,
        audioFileName,
        summary,
        file
    }: {
        content: string,
        transcript: string,
        audioFileName: string,
        summary: string,
        file: TFile
    }): string {
        const date = moment(file.stat.mtime).format('YYYY-MM-DD');
        const time = moment(file.stat.mtime).format('HH:mm');
        const template = `---
source: "[[${audioFileName}]]"
summary: "${summary}"
timestamp: "${moment(file.stat.mtime).toISOString(true)}"
tags: 
  - fromvoicenote
---
${content}

## Original transcript

${transcript}`;
        return template;
    }
}