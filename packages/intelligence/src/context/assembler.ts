import type { ContextChunk, ContextOptions, AssembledContext, ContextFormat } from './types.js';
import { estimateTokensSimple } from '../indexer/metadata/token-counter.js';

export class ContextAssemblerAgg {
  assemble(chunks: ContextChunk[], maxTokens: number, options: ContextOptions): AssembledContext {
    if (chunks.length === 0) {
      return { text: '', chunks: [], tokenCount: 0, format: options.format ?? 'xml' };
    }

    const format = options.format ?? 'xml';
    const overhead = this.estimateOverhead(format);
    const available = maxTokens - overhead;
    const selected: ContextChunk[] = [];
    let totalTokens = 0;

    for (const chunk of chunks) {
      let processed = chunk;

      // Summarize verbose content when requested
      if (options.summarize) {
        processed = this.summarizeChunk(processed);
      }

      const tokens = processed.tokenCount ?? estimateTokensSimple(processed.content);
      if (totalTokens + tokens > available) {
        // Try smart truncation: applies to the first chunk that exceeds the budget
        if ((options.compress ?? false) && available - totalTokens > 50) {
          const truncated = this.smartTruncate(processed, available - totalTokens);
          selected.push(truncated);
          totalTokens += truncated.tokenCount ?? 0;
        }
        break;
      }
      selected.push({ ...processed, tokenCount: tokens });
      totalTokens += tokens;
    }

    const text = this.format(selected, format, options.includeMetadata ?? false);
    return { text, chunks: selected, tokenCount: estimateTokensSimple(text), format };
  }

  private format(chunks: ContextChunk[], format: ContextFormat, includeMeta: boolean): string {
    switch (format) {
      case 'xml': return this.formatXML(chunks, includeMeta);
      case 'markdown': return this.formatMarkdown(chunks, includeMeta);
      case 'plain': return this.formatPlain(chunks, includeMeta);
      default: return this.formatXML(chunks, includeMeta);
    }
  }

  private formatXML(chunks: ContextChunk[], includeMeta: boolean): string {
    const parts = ['<retrieved_context>'];
    for (const chunk of chunks) {
      const loc = this.formatLocation(chunk);
      const meta = includeMeta
        ? ` relevance="${chunk.relevance.toFixed(3)}" source="${chunk.source}"`
        : ` source="${chunk.source}"`;
      parts.push(`  <chunk${meta}>`);
      parts.push(`    <location>${this.escapeXML(loc)}</location>`);
      parts.push(`    <content>`);
      parts.push(this.escapeXML(chunk.content));
      parts.push(`    </content>`);
      parts.push(`  </chunk>`);
    }
    parts.push('</retrieved_context>');
    return parts.join('\n');
  }

  private formatMarkdown(chunks: ContextChunk[], includeMeta: boolean): string {
    const parts: string[] = [];
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i]!;
      const loc = this.formatLocation(chunk);
      const score = includeMeta ? ` (relevance: ${chunk.relevance.toFixed(2)})` : '';
      const lang = chunk.metadata.language ?? '';
      parts.push(`### ${loc}${score}`);
      parts.push('');
      parts.push('```' + lang);
      parts.push(chunk.content);
      parts.push('```');
      if (i < chunks.length - 1) { parts.push(''); parts.push('---'); parts.push(''); }
    }
    return parts.join('\n');
  }

  private formatPlain(chunks: ContextChunk[], includeMeta: boolean): string {
    const parts: string[] = [];
    for (const chunk of chunks) {
      const loc = this.formatLocation(chunk);
      const score = includeMeta ? ` [score: ${chunk.relevance.toFixed(2)}]` : '';
      parts.push(`// ${loc}${score}`);
      parts.push(chunk.content);
      parts.push('');
      parts.push('---');
      parts.push('');
    }
    return parts.join('\n').trim();
  }

  private formatLocation(chunk: ContextChunk): string {
    const { filePath, startLine, endLine, url, title } = chunk.metadata;
    if (filePath) {
      if (startLine !== undefined && endLine !== undefined) return `${filePath}:${startLine}-${endLine}`;
      if (startLine !== undefined) return `${filePath}:${startLine}`;
      return filePath;
    }
    if (url) return title ? `${title} (${url})` : url;
    if (title) return title;
    return `${chunk.source}:${chunk.id}`;
  }

  /**
   * Summarize verbose content by stripping comment-only lines,
   * collapsing blank lines, and keeping the structural skeleton
   * (signatures, declarations) while trimming body details.
   */
  private summarizeChunk(chunk: ContextChunk): ContextChunk {
    const lines = chunk.content.split('\n');
    const summarized: string[] = [];
    let consecutiveBlanks = 0;

    for (const line of lines) {
      const trimmed = line.trim();

      // Skip pure comment lines (single-line and block comment lines)
      if (/^(\/\/|\/\*|\*\/|\*\s)/.test(trimmed) && !trimmed.includes('TODO') && !trimmed.includes('FIXME')) {
        continue;
      }

      // Collapse consecutive blank lines into at most one
      if (trimmed === '') {
        consecutiveBlanks++;
        if (consecutiveBlanks <= 1) summarized.push(line);
        continue;
      }

      consecutiveBlanks = 0;
      summarized.push(line);
    }

    const newContent = summarized.join('\n');
    return {
      ...chunk,
      content: newContent,
      tokenCount: estimateTokensSimple(newContent),
    };
  }

  private smartTruncate(chunk: ContextChunk, maxTokens: number): ContextChunk {
    const lines = chunk.content.split('\n');
    const truncated: string[] = [];
    let tokens = 0;
    for (const line of lines) {
      const lt = estimateTokensSimple(line);
      if (tokens + lt > maxTokens) break;
      truncated.push(line);
      tokens += lt;
    }
    truncated.push('// ... (truncated)');
    return { ...chunk, content: truncated.join('\n'), tokenCount: tokens };
  }

  private escapeXML(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  private estimateOverhead(format: ContextFormat): number {
    switch (format) {
      case 'xml': return 50;
      case 'markdown': return 30;
      case 'plain': return 20;
      default: return 50;
    }
  }
}

export function createContextAssemblerAgg(): ContextAssemblerAgg {
  return new ContextAssemblerAgg();
}
