import React, { useState, useRef, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from './card';
import { Button } from './button';
import { Input } from './input';
import { ScrollArea } from './scroll-area';
import { Badge } from './badge';
import { Separator } from './separator';
import { 
  MessageSquare, Send, Bot, User, Loader2, X, 
  ArrowUpDown, AlertCircle, CheckCircle 
} from 'lucide-react';
import type { ChatMessage, ChatState } from '../../types/exploration';

interface ChatInterfaceProps {
  chatState: ChatState;
  onSendMessage: (message: string) => void;
  onToggleChat: () => void;
  isConnected: boolean;
  className?: string;
}

export function ChatInterface({ 
  chatState, 
  onSendMessage, 
  onToggleChat, 
  isConnected, 
  className = '' 
}: ChatInterfaceProps) {
  const [inputMessage, setInputMessage] = useState('');
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (scrollAreaRef.current) {
      scrollAreaRef.current.scrollTop = scrollAreaRef.current.scrollHeight;
    }
  }, [chatState.messages]);

  const handleSendMessage = () => {
    if (inputMessage.trim() && isConnected) {
      onSendMessage(inputMessage.trim());
      setInputMessage('');
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const formatTime = (timestamp: string): string => {
    return new Date(timestamp).toLocaleTimeString();
  };

  const getRequestTypeColor = (requestType?: string) => {
    switch (requestType) {
      case 'task_specific': return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'exploration': return 'bg-green-100 text-green-800 border-green-200';
      case 'question': return 'bg-purple-100 text-purple-800 border-purple-200';
      default: return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  if (!chatState.isActive) {
    return (
      <div className={`fixed bottom-4 right-4 z-50 ${className}`}>
        <Button
          onClick={onToggleChat}
          className="rounded-full w-12 h-12 shadow-lg"
          disabled={!isConnected}
        >
          <MessageSquare className="w-5 h-5" />
        </Button>
      </div>
    );
  }

  return (
    <div className={`fixed bottom-4 right-4 w-96 h-[500px] z-50 ${className}`}>
      <Card className="h-full flex flex-col shadow-xl border-2">
        {/* Chat Header */}
        <CardHeader className="pb-3 flex-shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <MessageSquare className="w-4 h-4" />
              <CardTitle className="text-sm">Chat with Agent</CardTitle>
              <Badge 
                variant={isConnected ? "default" : "destructive"} 
                className="text-xs"
              >
                {isConnected ? "Connected" : "Disconnected"}
              </Badge>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0"
              onClick={onToggleChat}
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
        </CardHeader>

        {/* Chat Messages */}
        <CardContent className="flex-1 overflow-hidden p-0">
          <ScrollArea className="h-full p-4" ref={scrollAreaRef}>
            <div className="space-y-3">
              {chatState.messages.length === 0 && (
                <div className="text-center text-muted-foreground text-xs py-8">
                  <Bot className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p>Start a conversation with the AI agent</p>
                  <p className="mt-1 text-xs">
                    You can ask questions, request specific tasks, or explore pages
                  </p>
                </div>
              )}

              {chatState.messages.map((message) => (
                <div key={message.id} className="space-y-1">
                  <div className={`flex ${message.type === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[80%] rounded-lg p-2 text-xs ${
                      message.type === 'user' 
                        ? 'bg-primary text-primary-foreground' 
                        : 'bg-muted'
                    }`}>
                      <div className="flex items-center gap-1 mb-1">
                        {message.type === 'user' ? (
                          <User className="w-3 h-3" />
                        ) : (
                          <Bot className="w-3 h-3" />
                        )}
                        <span className="font-medium">
                          {message.type === 'user' ? 'You' : 'Assistant'}
                        </span>
                        {message.requestType && (
                          <Badge 
                            variant="outline" 
                            className={`text-xs h-4 ${getRequestTypeColor(message.requestType)}`}
                          >
                            {message.requestType.replace('_', ' ')}
                          </Badge>
                        )}
                      </div>
                      <p className="whitespace-pre-wrap">{message.content}</p>
                      <div className="text-xs opacity-70 mt-1">
                        {formatTime(message.timestamp)}
                      </div>
                    </div>
                  </div>
                </div>
              ))}

              {/* Processing indicator */}
              {chatState.isProcessing && (
                <div className="flex justify-start">
                  <div className="bg-muted rounded-lg p-2 text-xs max-w-[80%]">
                    <div className="flex items-center gap-2">
                      <Loader2 className="w-3 h-3 animate-spin" />
                      <span>Assistant is thinking...</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </ScrollArea>
        </CardContent>

        <Separator />

        {/* Chat Input */}
        <div className="p-4 flex-shrink-0">
          <div className="flex gap-2">
            <Input
              ref={inputRef}
              value={inputMessage}
              onChange={(e) => setInputMessage(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder={
                isConnected 
                  ? "Ask a question or give a task..."
                  : "Connecting..."
              }
              disabled={!isConnected || chatState.isProcessing}
              className="text-xs"
            />
            <Button
              onClick={handleSendMessage}
              disabled={!inputMessage.trim() || !isConnected || chatState.isProcessing}
              size="sm"
              className="flex-shrink-0"
            >
              {chatState.isProcessing ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
            </Button>
          </div>
          
          {/* Chat hints */}
          <div className="mt-2 text-xs text-muted-foreground">
            <p>💡 Examples: "Navigate to the pricing page", "What can this page do?", "Fill out the contact form"</p>
          </div>
        </div>
      </Card>
    </div>
  );
} 