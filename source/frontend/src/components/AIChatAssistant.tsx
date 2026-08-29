import React, { useState, useEffect, useRef } from 'react'
import {
  Send, X, Paperclip, Mic, Info, Trash2, Command, Zap,
  Copy, RotateCcw, ThumbsUp, ThumbsDown, ChevronDown, ChevronUp,
  Sparkles, TrendingUp
} from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { vscDarkPlus, vs } from 'react-syntax-highlighter/dist/esm/styles/prism'
import './AIChatAssistant.css'

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
  attachments?: {
    mimeType: string
    url: string
    data?: string
  }[]
  error?: {
    type: 'network' | 'api_key' | 'rate_limit' | 'unknown'
    message: string
    retryable: boolean
  }
}

interface SuggestionChip {
  icon: string
  label: string
  command: string
}

interface UserPreferences {
  commonCommands: { [command: string]: number }
  lastUsedCommands: string[]
  preferredTheme?: 'light' | 'dark'
  timestamp: number
}

interface AppContext {
  selectedFileCount?: number
  totalFiles?: number
  totalGroups?: number
  isInTrash?: boolean
  hasGroups?: boolean
}

interface AIChatAssistantProps {
  onCommand: (query: string, attachments?: any[]) => Promise<any>
  onClose: () => void
  skills: string[]
  theme: 'light' | 'dark'
  context?: AppContext
}

const AIChatAssistant: React.FC<AIChatAssistantProps> = ({
  onCommand,
  onClose,
  skills,
  theme,
  context = {}
}) => {
  const [messages, setMessages] = useState<Message[]>(() => {
    const saved = localStorage.getItem('ai_chat_history')
    if (saved) {
      try {
        const parsed = JSON.parse(saved)
        const now = Date.now()
        // 24 hour auto-reset + max 50 messages
        return parsed
          .filter((m: Message) => now - m.timestamp < 24 * 60 * 60 * 1000)
          .slice(-50)
      } catch (e) {
        return []
      }
    }
    return []
  })

  const [input, setInput] = useState('')
  const [showSkills, setShowSkills] = useState(false)
  const [showSlashMenu, setShowSlashMenu] = useState(false)
  const [attachments, setAttachments] = useState<any[]>([])
  const [isTyping, setIsTyping] = useState(false)
  const [collapsedMessages, setCollapsedMessages] = useState<Set<string>>(new Set())
  const [isListening, setIsListening] = useState(false)
  const [suggestions, setSuggestions] = useState<SuggestionChip[]>([])

  const scrollRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const recognitionRef = useRef<any>(null)

  const slashCommands = [
    { cmd: '/merge', desc: 'Merge groups', params: '[group names]' },
    { cmd: '/theme', desc: 'Switch theme', params: 'light|dark' },
    { cmd: '/trash', desc: 'View trash', params: '' },
    { cmd: '/restore', desc: 'Restore from trash', params: '' },
    { cmd: '/group', desc: 'AI group files', params: '' },
    { cmd: '/select', desc: 'Select by pattern', params: '[pattern]' },
    { cmd: '/rename', desc: 'Batch rename', params: '[pattern]' },
    { cmd: '/folder', desc: 'Create folder', params: '[name]' },
    { cmd: '/move', desc: 'Move to folder', params: '[folder]' },
    { cmd: '/filter', desc: 'Filter by type', params: '[extension]' },
    { cmd: '/stats', desc: 'Show statistics', params: '' },
    { cmd: '/help', desc: 'Show help', params: '' }
  ]

  // User preference management
  const loadPreferences = (): UserPreferences => {
    const saved = localStorage.getItem('ai_preferences')
    if (saved) {
      try {
        return JSON.parse(saved)
      } catch (e) {
        return { commonCommands: {}, lastUsedCommands: [], timestamp: Date.now() }
      }
    }
    return { commonCommands: {}, lastUsedCommands: [], timestamp: Date.now() }
  }

  const savePreferences = (prefs: UserPreferences) => {
    localStorage.setItem('ai_preferences', JSON.stringify(prefs))
  }

  const trackCommand = (command: string) => {
    const prefs = loadPreferences()

    // Track frequency
    prefs.commonCommands[command] = (prefs.commonCommands[command] || 0) + 1

    // Track recent usage
    prefs.lastUsedCommands = [command, ...prefs.lastUsedCommands.filter(c => c !== command)].slice(0, 10)

    prefs.timestamp = Date.now()
    savePreferences(prefs)
  }

  // Generate context-aware suggestions
  const generateSuggestions = (): SuggestionChip[] => {
    const chips: SuggestionChip[] = []
    const prefs = loadPreferences()

    // Context-based suggestions
    if (context.isInTrash) {
      chips.push(
        { icon: '🔄', label: 'Restore all', command: 'restore all items from trash' },
        { icon: '🗑️', label: 'Empty trash', command: 'empty trash permanently' }
      )
    } else if (context.selectedFileCount && context.selectedFileCount >= 5) {
      chips.push(
        { icon: '📁', label: `Group ${context.selectedFileCount} files`, command: 'create a group from selected files' },
        { icon: '📂', label: 'Move to folder', command: 'move selected files to a folder' }
      )
    } else if (context.hasGroups && context.totalGroups && context.totalGroups >= 2) {
      chips.push(
        { icon: '🔀', label: 'Merge groups', command: 'merge similar groups' },
        { icon: '📊', label: 'Group stats', command: 'show statistics for all groups' }
      )
    } else if (context.totalFiles && context.totalFiles > 10) {
      chips.push(
        { icon: '🤖', label: 'Analyze files', command: 'analyze all files and create groups' },
        { icon: '📈', label: 'Show stats', command: 'show file statistics' }
      )
    }

    // Add frequent commands (max 2)
    const sortedCommands = Object.entries(prefs.commonCommands)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2)
      .map(([cmd]) => cmd)

    sortedCommands.forEach(cmd => {
      if (chips.length < 4) {
        chips.push({ icon: '⚡', label: cmd.slice(0, 20), command: cmd })
      }
    })

    // Limit to 4 chips
    return chips.slice(0, 4)
  }

  // Update suggestions when context changes
  useEffect(() => {
    setSuggestions(generateSuggestions())
  }, [context.selectedFileCount, context.totalFiles, context.isInTrash, context.hasGroups, context.totalGroups])

  useEffect(() => {
    localStorage.setItem('ai_chat_history', JSON.stringify(messages))
    if (scrollRef.current) {
      const isNearBottom = scrollRef.current.scrollHeight - scrollRef.current.scrollTop - scrollRef.current.clientHeight < 100
      if (isNearBottom) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight
      }
    }
  }, [messages])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  // Web Speech API setup
  useEffect(() => {
    if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
      const SpeechRecognition = (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition
      recognitionRef.current = new SpeechRecognition()
      recognitionRef.current.continuous = false
      recognitionRef.current.interimResults = false
      recognitionRef.current.lang = 'id-ID' // Indonesian, fallback to en-US

      recognitionRef.current.onresult = (event: any) => {
        const transcript = event.results[0][0].transcript
        setInput(transcript)
        setIsListening(false)
      }

      recognitionRef.current.onerror = () => {
        setIsListening(false)
      }

      recognitionRef.current.onend = () => {
        setIsListening(false)
      }
    }
  }, [])

  const handleSend = async () => {
    if (!input.trim() && attachments.length === 0) return

    const userMsg: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input,
      timestamp: Date.now(),
      attachments: attachments.map(a => ({ mimeType: a.mimeType, url: a.url, data: a.data }))
    }

    // Track command for learning
    trackCommand(input.trim())

    setMessages(prev => [...prev, userMsg])
    setInput('')
    setAttachments([])
    setIsTyping(true)

    try {
      const result = await onCommand(userMsg.content, userMsg.attachments)

      const aiMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: result?.message || 'Done.',
        timestamp: Date.now()
      }

      setMessages(prev => [...prev, aiMsg])
    } catch (err: any) {
      // Enhanced error handling with better categorization
      let errorType: 'network' | 'api_key' | 'rate_limit' | 'unknown' = 'unknown'
      let errorMessage = err?.message || 'Unknown error occurred'
      let retryable = true

      // Log full error for debugging
      console.error('AI Error Details:', err)

      // Convert error message to lowercase for easier matching
      const lowerMsg = errorMessage.toLowerCase()

      // Check for specific error patterns
      if (lowerMsg.includes('fetch') || lowerMsg.includes('network') || lowerMsg.includes('connection')) {
        errorType = 'network'
        errorMessage = "❌ Can't reach Gemini servers. Check your internet connection."
      } else if (lowerMsg.includes('quota') || lowerMsg.includes('429') || lowerMsg.includes('exceeded')) {
        errorType = 'rate_limit'
        errorMessage = "⚠️ API quota exceeded or rate limit reached. Please wait a moment or check your Gemini API plan."
      } else if (lowerMsg.includes('api key') || lowerMsg.includes('invalid key') || lowerMsg.includes('unauthorized') || lowerMsg.includes('401') || lowerMsg.includes('403')) {
        errorType = 'api_key'
        errorMessage = "❌ API key seems invalid or unauthorized. Please update it in Settings."
        retryable = false
      } else if (lowerMsg.includes('offline')) {
        errorType = 'api_key'
        errorMessage = "⚠️ AI Assistant is offline. Please set your Gemini API key in Settings."
        retryable = false
      } else {
        // Generic error - try to extract useful info from the error message
        errorMessage = `❌ ${errorMessage}`
      }

      setMessages(prev => [...prev, {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: errorMessage,
        timestamp: Date.now(),
        error: { type: errorType, message: errorMessage, retryable }
      }])
    } finally {
      setIsTyping(false)
    }
  }

  const handleRetry = async (msgId: string) => {
    const msgIndex = messages.findIndex(m => m.id === msgId)
    if (msgIndex === -1) return

    const previousUserMsg = messages[msgIndex - 1]
    if (!previousUserMsg || previousUserMsg.role !== 'user') return

    // Remove error message and retry
    setMessages(prev => prev.filter(m => m.id !== msgId))
    setIsTyping(true)

    try {
      const result = await onCommand(previousUserMsg.content, previousUserMsg.attachments)

      const aiMsg: Message = {
        id: Date.now().toString(),
        role: 'assistant',
        content: result?.message || 'Done.',
        timestamp: Date.now()
      }

      setMessages(prev => [...prev, aiMsg])
    } catch (err: any) {
      setMessages(prev => [...prev, {
        id: Date.now().toString(),
        role: 'assistant',
        content: `Error: ${err?.message || 'Unknown error'}`,
        timestamp: Date.now(),
        error: { type: 'unknown', message: err?.message, retryable: true }
      }])
    } finally {
      setIsTyping(false)
    }
  }

  const handleRegenerate = async (msgId: string) => {
    const msgIndex = messages.findIndex(m => m.id === msgId)
    if (msgIndex === -1) return

    const previousUserMsg = messages[msgIndex - 1]
    if (!previousUserMsg || previousUserMsg.role !== 'user') return

    setMessages(prev => prev.filter(m => m.id !== msgId))
    setIsTyping(true)

    try {
      const result = await onCommand(previousUserMsg.content + ' (Regenerate)', previousUserMsg.attachments)

      const aiMsg: Message = {
        id: Date.now().toString(),
        role: 'assistant',
        content: result?.message || 'Done.',
        timestamp: Date.now()
      }

      setMessages(prev => [...prev, aiMsg])
    } catch (err: any) {
      setMessages(prev => [...prev, {
        id: Date.now().toString(),
        role: 'assistant',
        content: `Error: ${err?.message || 'Unknown error'}`,
        timestamp: Date.now()
      }])
    } finally {
      setIsTyping(false)
    }
  }

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      // Optional: show toast notification
    })
  }

  const toggleCollapse = (msgId: string) => {
    setCollapsedMessages(prev => {
      const next = new Set(prev)
      if (next.has(msgId)) {
        next.delete(msgId)
      } else {
        next.add(msgId)
      }
      return next
    })
  }

  const handleAttachment = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files) return

    Array.from(files).forEach(file => {
      const reader = new FileReader()
      reader.onloadend = () => {
        setAttachments(prev => [...prev, {
          mimeType: file.type,
          url: URL.createObjectURL(file),
          data: (reader.result as string).split(',')[1] // base64
        }])
      }
      reader.readAsDataURL(file)
    })
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value
    setInput(val)

    // Debounced slash menu
    if (val.startsWith('/')) {
      setShowSlashMenu(true)
    } else {
      setShowSlashMenu(false)
    }
  }

  const selectSlashCommand = (cmd: string) => {
    setInput(cmd + ' ')
    setShowSlashMenu(false)
    inputRef.current?.focus()
  }

  const clearHistory = () => {
    if (window.confirm('Hapus riwayat chat?')) {
      setMessages([])
      localStorage.removeItem('ai_chat_history')
    }
  }

  const startVoiceInput = () => {
    if (recognitionRef.current && !isListening) {
      setIsListening(true)
      recognitionRef.current.start()
    }
  }

  const stopVoiceInput = () => {
    if (recognitionRef.current && isListening) {
      recognitionRef.current.stop()
      setIsListening(false)
    }
  }

  const handleSuggestionClick = (suggestion: SuggestionChip) => {
    setInput(suggestion.command)
    inputRef.current?.focus()
  }

  // Check if message is long (>10 lines or >500 chars)
  const isLongMessage = (content: string) => {
    return content.length > 500 || content.split('\n').length > 10
  }

  return (
    <div className={`ai-assistant-persistent ${theme}`}>
      <div className="ai-chat-header">
        <div className="header-info">
          <div className="status-indicator online"></div>
          <div className="title-group">
            <h3>AI ASSISTANT</h3>
            <span className="status-text">Online - Gemini Flash</span>
          </div>
        </div>
        <div className="header-actions">
          <button onClick={() => setShowSkills(!showSkills)} className="icon-btn" title="AI Skills">
            <Info size={18} />
          </button>
          <button onClick={clearHistory} className="icon-btn" title="Clear History">
            <Trash2 size={18} />
          </button>
          <button onClick={onClose} className="icon-btn close">
            <X size={18} />
          </button>
        </div>
      </div>

      {showSkills && (
        <div className="skills-overlay">
          <div className="skills-header">
            <h4><Zap size={14} /> AI Capabilities</h4>
            <button onClick={() => setShowSkills(false)}><X size={14} /></button>
          </div>
          <ul>
            {skills.map((skill, i) => <li key={i}>{skill}</li>)}
            <li className="hint">💡 Tip: Rate responses with 👍/👎 to improve suggestions.</li>
          </ul>
        </div>
      )}

      <div className="ai-chat-messages" ref={scrollRef}>
        {messages.length === 0 && (
          <div className="empty-state">
            <div className="ai-avatar-large">
              <Zap size={32} />
            </div>
            <p>Halo! Saya asisten PhotoSort yang telah ditingkatkan.</p>
            <p className="subtext">Tanyakan apa saja atau gunakan <code>/</code> untuk perintah cepat.</p>
            <div className="suggested-prompts">
              <button onClick={() => setInput('Analisa file-file saya dan buat grup')}>📊 Analisa & buat grup</button>
              <button onClick={() => setInput('Berapa total file yang ada?')}>📁 Statistik file</button>
              <button onClick={() => setInput('/theme')}>🎨 Ganti tema</button>
            </div>
          </div>
        )}

        {/* Context-aware smart suggestions */}
        {suggestions.length > 0 && messages.length > 0 && (
          <div className="suggestion-chips">
            <div className="suggestion-header">
              <Sparkles size={14} />
              <span>Suggested actions</span>
            </div>
            <div className="chips-container">
              {suggestions.map((chip, idx) => (
                <button
                  key={idx}
                  className="suggestion-chip"
                  onClick={() => handleSuggestionClick(chip)}
                  title={chip.command}
                >
                  <span className="chip-icon">{chip.icon}</span>
                  <span className="chip-label">{chip.label}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map(msg => {
          const isLong = msg.role === 'assistant' && isLongMessage(msg.content)
          const isCollapsed = collapsedMessages.has(msg.id)

          return (
            <div key={msg.id} className={`message-bubble ${msg.role} ${msg.error ? 'error' : ''}`}>
              {msg.attachments && msg.attachments.length > 0 && (
                <div className="message-attachments">
                  {msg.attachments.map((att, i) => (
                    <div key={i} className="att-preview">
                      {att.mimeType.startsWith('image/') ? (
                        <img src={att.url} alt="upload" />
                      ) : (
                        <div className="file-icon"><Mic size={16} /></div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              <div className={`message-content ${isCollapsed ? 'collapsed' : ''}`}>
                {msg.role === 'assistant' && !msg.error ? (
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      code({ className, children, ...props }: any) {
                        const inline = !className
                        const match = /language-(\w+)/.exec(className || '')
                        return !inline && match ? (
                          <SyntaxHighlighter
                            style={theme === 'dark' ? vscDarkPlus : vs}
                            language={match[1]}
                            PreTag="div"
                            {...props}
                          >
                            {String(children).replace(/\n$/, '')}
                          </SyntaxHighlighter>
                        ) : (
                          <code className={className} {...props}>
                            {children}
                          </code>
                        )
                      }
                    }}
                  >
                    {msg.content}
                  </ReactMarkdown>
                ) : (
                  <div className="plain-text">{msg.content}</div>
                )}
              </div>

              {isLong && (
                <button className="collapse-btn" onClick={() => toggleCollapse(msg.id)}>
                  {isCollapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
                  {isCollapsed ? 'Show more' : 'Show less'}
                </button>
              )}

              <div className="message-time">
                {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </div>

              {msg.role === 'assistant' && (
                <div className="message-actions">
                  <button onClick={() => copyToClipboard(msg.content)} title="Copy">
                    <Copy size={14} />
                  </button>
                  {!msg.error && (
                    <button onClick={() => handleRegenerate(msg.id)} title="Regenerate">
                      <RotateCcw size={14} />
                    </button>
                  )}
                  {msg.error?.retryable && (
                    <button onClick={() => handleRetry(msg.id)} className="retry-btn" title="Retry">
                      <RotateCcw size={14} /> Retry
                    </button>
                  )}
                  <button title="Rate good"><ThumbsUp size={14} /></button>
                  <button title="Rate bad"><ThumbsDown size={14} /></button>
                </div>
              )}
            </div>
          )
        })}

        {isTyping && (
          <div className="message-bubble assistant typing">
            <div className="typing-indicator">
              <span></span><span></span><span></span>
            </div>
          </div>
        )}
      </div>

      <div className="ai-chat-input-area">
        {showSlashMenu && (
          <div className="slash-menu">
            {slashCommands
              .filter(c => c.cmd.toLowerCase().includes(input.toLowerCase()))
              .map(c => (
                <div key={c.cmd} className="slash-item" onClick={() => selectSlashCommand(c.cmd)}>
                  <Command size={14} />
                  <span className="cmd">{c.cmd}</span>
                  <span className="params">{c.params}</span>
                  <span className="desc">{c.desc}</span>
                </div>
              ))}
          </div>
        )}

        {attachments.length > 0 && (
          <div className="input-attachments-preview">
            {attachments.map((att, i) => (
              <div key={i} className="att-item">
                <img src={att.url} alt="attachment" />
                <button onClick={() => setAttachments(prev => prev.filter((_, idx) => idx !== i))}>
                  <X size={10} />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="input-row">
          <button className="icon-btn" onClick={() => fileInputRef.current?.click()} title="Attach file">
            <Paperclip size={20} />
          </button>
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleAttachment}
            hidden
            multiple
            accept="image/*,audio/*"
          />

          {recognitionRef.current && (
            <button
              className={`icon-btn ${isListening ? 'listening' : ''}`}
              onClick={isListening ? stopVoiceInput : startVoiceInput}
              title="Voice input"
            >
              <Mic size={20} />
            </button>
          )}

          <textarea
            ref={inputRef}
            placeholder="Ketik pesan atau / untuk perintah..."
            value={input}
            onChange={handleInputChange}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                handleSend()
              }
            }}
            rows={1}
          />

          <button className={`send-btn ${input || attachments.length > 0 ? 'active' : ''}`} onClick={handleSend}>
            <Send size={18} />
          </button>
        </div>
      </div>
    </div>
  )
}

export default AIChatAssistant
