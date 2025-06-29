import React, { useEffect, useState, type JSX } from 'react';
import { cn } from '../../lib/utils';
import { 
  Code, 
  Link, 
  List, 
  Hash, 
  ChevronRight,
  Copy,
  Check,
  Table,
  FileText,
  AlertCircle,
  Info,
  CheckCircle,
  XCircle
} from 'lucide-react';
import { Button } from './button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './tooltip';

interface MarkdownViewerProps {
  markdown: string;
  className?: string;
}

export function MarkdownViewer({ markdown, className }: MarkdownViewerProps) {
  const [copiedBlocks, setCopiedBlocks] = useState<Set<number>>(new Set());

  const copyToClipboard = async (text: string, index: number) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedBlocks(prev => new Set(prev).add(index));
      setTimeout(() => {
        setCopiedBlocks(prev => {
          const newSet = new Set(prev);
          newSet.delete(index);
          return newSet;
        });
      }, 2000);
    } catch (err) {
      console.error('Failed to copy text:', err);
    }
  };

  const parseMarkdown = (text: string): JSX.Element[] => {
    const lines = text.split('\n');
    const elements: JSX.Element[] = [];
    let inCodeBlock = false;
    let codeContent: string[] = [];
    let codeLanguage = '';
    let codeBlockIndex = 0;
    let inList = false;
    let listItems: JSX.Element[] = [];
    let inTable = false;
    let tableRows: string[][] = [];
    let tableHeader: string[] = [];

    const processInlineFormatting = (text: string): JSX.Element | string => {
      // Process inline code
      let processed = text.split(/`([^`]+)`/g).map((part, i) => {
        if (i % 2 === 1) {
          return (
            <code key={i} className="px-1 py-0.5 bg-muted rounded text-xs font-mono text-primary">
              {part}
            </code>
          );
        }
        
        // Process bold text
        return part.split(/\*\*([^*]+)\*\*/g).map((subPart, j) => {
          if (j % 2 === 1) {
            return <strong key={`${i}-${j}`} className="font-semibold text-foreground">{subPart}</strong>;
          }
          
          // Process italic text
          return subPart.split(/\*([^*]+)\*/g).map((subSubPart, k) => {
            if (k % 2 === 1) {
              return <em key={`${i}-${j}-${k}`}>{subSubPart}</em>;
            }
            
            // Process links
            const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
            const parts = [];
            let lastIndex = 0;
            let match;
            
            while ((match = linkRegex.exec(subSubPart)) !== null) {
              if (match.index > lastIndex) {
                parts.push(subSubPart.substring(lastIndex, match.index));
              }
              parts.push(
                <a
                  key={`link-${match.index}`}
                  href={match[2]}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline inline-flex items-center gap-1"
                >
                  {match[1]}
                  <Link className="w-3 h-3" />
                </a>
              );
              lastIndex = match.index + match[0].length;
            }
            
            if (lastIndex < subSubPart.length) {
              parts.push(subSubPart.substring(lastIndex));
            }
            
            return parts.length > 1 ? parts : subSubPart;
          });
        });
      });

      return <>{processed}</>;
    };

    const finishList = () => {
      if (inList && listItems.length > 0) {
        elements.push(
          <ul key={`list-${elements.length}`} className="space-y-1 my-2">
            {listItems}
          </ul>
        );
        listItems = [];
        inList = false;
      }
    };

    const finishTable = () => {
      if (inTable && tableRows.length > 0) {
        elements.push(
          <div key={`table-${elements.length}`} className="my-4 overflow-x-auto">
            <table className="min-w-full divide-y divide-border">
              <thead className="bg-muted">
                <tr>
                  {tableHeader.map((header, i) => (
                    <th key={i} className="px-3 py-2 text-left text-xs font-medium text-foreground">
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {tableRows.map((row, i) => (
                  <tr key={i} className="hover:bg-muted/50">
                    {row.map((cell, j) => (
                      <td key={j} className="px-3 py-2 text-xs">
                        {processInlineFormatting(cell)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
        tableRows = [];
        tableHeader = [];
        inTable = false;
      }
    };

    lines.forEach((line, lineIndex) => {
      // Code blocks
      if (line.startsWith('```')) {
        if (!inCodeBlock) {
          finishList();
          finishTable();
          inCodeBlock = true;
          codeLanguage = line.substring(3).trim() || 'plaintext';
          codeContent = [];
        } else {
          const currentBlockIndex = codeBlockIndex++;
          const codeText = codeContent.join('\n');
          elements.push(
            <div key={`code-${lineIndex}`} className="my-3 group relative">
              <div className="flex items-center justify-between bg-muted/50 px-3 py-1 rounded-t-md border border-b-0 border-border">
                <span className="text-xs text-muted-foreground font-mono">{codeLanguage}</span>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2"
                        onClick={() => copyToClipboard(codeText, currentBlockIndex)}
                      >
                        {copiedBlocks.has(currentBlockIndex) ? (
                          <Check className="w-3 h-3 text-green-500" />
                        ) : (
                          <Copy className="w-3 h-3" />
                        )}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="text-xs">Copy code</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
              <pre className="bg-muted/30 p-3 rounded-b-md border border-border overflow-x-auto">
                <code className="text-xs font-mono text-foreground/90">
                  {codeText}
                </code>
              </pre>
            </div>
          );
          inCodeBlock = false;
          codeLanguage = '';
        }
        return;
      }

      if (inCodeBlock) {
        codeContent.push(line);
        return;
      }

      // Tables
      if (line.includes('|') && line.trim().startsWith('|') && line.trim().endsWith('|')) {
        const cells = line.split('|').slice(1, -1).map(cell => cell.trim());
        
        if (!inTable) {
          finishList();
          inTable = true;
          tableHeader = cells;
        } else if (line.match(/^[\s|:-]+$/)) {
          // Separator line, skip
        } else {
          tableRows.push(cells);
        }
        return;
      } else if (inTable) {
        finishTable();
      }

      // Headers
      const headerMatch = line.match(/^(#{1,6})\s+(.+)$/);
      if (headerMatch) {
        finishList();
        finishTable();
        const level = headerMatch[1].length;
        const text = headerMatch[2];
        const HeadingTag = `h${level}` as keyof JSX.IntrinsicElements;
        
        const headerClasses = {
          1: 'text-xl font-bold mt-4 mb-3 text-foreground',
          2: 'text-lg font-semibold mt-3 mb-2 text-foreground',
          3: 'text-base font-medium mt-2 mb-1 text-foreground',
          4: 'text-sm font-medium mt-2 mb-1 text-foreground',
          5: 'text-sm font-medium mt-1 mb-1 text-foreground/90',
          6: 'text-xs font-medium mt-1 mb-1 text-foreground/80'
        };

        elements.push(
          <HeadingTag key={lineIndex} className={headerClasses[level as keyof typeof headerClasses]}>
            {processInlineFormatting(text)}
          </HeadingTag>
        );
        return;
      }

      // Lists
      const listMatch = line.match(/^(\s*)([-*+]|\d+\.)\s+(.+)$/);
      if (listMatch) {
        const indent = listMatch[1].length;
        const marker = listMatch[2];
        const content = listMatch[3];
        
        if (!inList) {
          inList = true;
        }

        listItems.push(
          <li key={`list-item-${lineIndex}`} className={cn("flex items-start gap-2", indent > 0 && "ml-4")}>
            <span className="text-primary mt-0.5 flex-shrink-0">
              {marker.match(/\d+\./) ? marker : '•'}
            </span>
            <span className="text-xs text-muted-foreground">
              {processInlineFormatting(content)}
            </span>
          </li>
        );
        return;
      } else if (inList) {
        finishList();
      }

      // Blockquotes
      if (line.startsWith('>')) {
        finishList();
        finishTable();
        const content = line.substring(1).trim();
        elements.push(
          <blockquote key={lineIndex} className="border-l-4 border-primary/20 pl-4 my-2 italic text-muted-foreground">
            <p className="text-xs">{processInlineFormatting(content)}</p>
          </blockquote>
        );
        return;
      }

      // Horizontal rules
      if (line.match(/^[-*_]{3,}$/)) {
        finishList();
        finishTable();
        elements.push(
          <hr key={lineIndex} className="my-4 border-border" />
        );
        return;
      }

      // Alert/callout blocks
      const alertMatch = line.match(/^(NOTE|TIP|WARNING|IMPORTANT|CAUTION):\s*(.+)$/i);
      if (alertMatch) {
        finishList();
        finishTable();
        const type = alertMatch[1].toUpperCase();
        const content = alertMatch[2];
        
        const alertStyles = {
          NOTE: { icon: Info, className: 'border-blue-500/20 bg-blue-500/5 text-blue-600' },
          TIP: { icon: CheckCircle, className: 'border-green-500/20 bg-green-500/5 text-green-600' },
          WARNING: { icon: AlertCircle, className: 'border-yellow-500/20 bg-yellow-500/5 text-yellow-600' },
          IMPORTANT: { icon: AlertCircle, className: 'border-orange-500/20 bg-orange-500/5 text-orange-600' },
          CAUTION: { icon: XCircle, className: 'border-red-500/20 bg-red-500/5 text-red-600' }
        };

        const style = alertStyles[type as keyof typeof alertStyles] || alertStyles.NOTE;
        const Icon = style.icon;

        elements.push(
          <div key={lineIndex} className={cn("flex items-start gap-2 p-3 my-2 border rounded-md", style.className)}>
            <Icon className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <div className="flex-1">
              <p className="text-xs font-medium mb-1">{type}</p>
              <p className="text-xs">{processInlineFormatting(content)}</p>
            </div>
          </div>
        );
        return;
      }

      // Regular paragraphs
      const trimmedLine = line.trim();
      if (trimmedLine.length > 0) {
        finishList();
        finishTable();
        elements.push(
          <p key={lineIndex} className="text-xs text-muted-foreground my-2 leading-relaxed">
            {processInlineFormatting(trimmedLine)}
          </p>
        );
      }
    });

    // Finish any remaining lists or tables
    finishList();
    finishTable();

    return elements;
  };

  return (
    <div className={cn("prose prose-sm max-w-none", className)}>
      {parseMarkdown(markdown)}
    </div>
  );
}