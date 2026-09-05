'use client'

import { useEffect, useState, useRef } from 'react'
import { useChat } from '@ai-sdk/react'
import { getAllArticles } from '@/data/articles'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

// Inline SVG icons
const CopyIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <rect width="14" height="14" x="8" y="8" rx="2" ry="2" strokeWidth={2} />
    <path strokeWidth={2} d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
  </svg>
)

const CheckIcon = () => (
  <svg className="w-4 h-4 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 6 9 17l-5-5" />
  </svg>
)

interface Payment {
  slug: string
  amount: number
  txHash: string | null
  payer: string
  timestamp: number
}

interface ArticleStats {
  slug: string
  title: string
  views: number
  revenue: number
}

interface MerchantWallet {
  id: string
  address: string
}

interface Stats {
  totalRevenue: number
  totalPayments: number
  recentPayments: Payment[]
  articleStats: ArticleStats[]
  merchantWallet: MerchantWallet | null
  onChainBalance: string | null
}

export default function MerchantDashboard() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null)
  const [baseUrl, setBaseUrl] = useState('')
  const [copiedSlug, setCopiedSlug] = useState<string | null>(null)
  const articles = getAllArticles()

  // Buyer Agent chat using Vercel AI SDK
  const { messages, sendMessage, status } = useChat()
  const [agentInput, setAgentInput] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Get base URL on mount
  useEffect(() => {
    setBaseUrl(window.location.origin)
  }, [])

  // Copy to clipboard handler
  const copyToClipboard = async (text: string, slug: string) => {
    await navigator.clipboard.writeText(text)
    setCopiedSlug(slug)
    setTimeout(() => setCopiedSlug(null), 2000)
  }

  // Fetch stats
  const fetchStats = async () => {
    try {
      const res = await fetch('/api/stats')
      const data = await res.json()
      setStats(data)
      setLastUpdate(new Date())
    } catch (err) {
      console.error('Failed to fetch stats:', err)
    } finally {
      setLoading(false)
    }
  }

  // Poll every 3 seconds
  useEffect(() => {
    fetchStats()
    const interval = setInterval(fetchStats, 3000)
    return () => clearInterval(interval)
  }, [])

  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp)
    return date.toLocaleTimeString()
  }

  const formatBalance = (balance: string | null) => {
    if (!balance) return '0.00'
    const num = parseFloat(balance)
    return num.toFixed(2)
  }

  // Run buyer agent
  const runBuyerAgent = () => {
    if (!agentInput.trim() || status !== 'ready') return
    sendMessage({ text: agentInput.trim() })
    setAgentInput('')
  }

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      {/* Header */}
      <header className="border-b border-zinc-800 p-6">
        <div className="mx-auto max-w-6xl flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src="/arc-merchant-logo.png" alt="Arc Merchant" className="w-9 h-9 rounded-lg" />
            <div>
            <h1 className="text-2xl font-bold">
              <span className="text-blue-400">Arc</span> Merchant Dashboard
            </h1>
            <p className="text-sm text-zinc-500 mt-1">
              Sell content to AI agents. Watch payments land on-chain in real time.
            </p>
            </div>
          </div>
          <div className="text-right">
            <div className="flex items-center gap-2 text-sm text-zinc-400">
              <span className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
              Live
            </div>
            {lastUpdate && (
              <p className="text-xs text-zinc-600 mt-1">
                Updated {lastUpdate.toLocaleTimeString()}
              </p>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl p-6">
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="animate-spin text-4xl">Loading...</div>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Merchant Wallet Info */}
            {stats?.merchantWallet && (
              <div className="rounded-xl bg-gradient-to-r from-blue-900/30 to-purple-900/30 border border-blue-800/50 p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-zinc-400 mb-1">Merchant Wallet (Circle)</p>
                    <a
                      href={`https://testnet.arcscan.app/address/${stats.merchantWallet.address}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-blue-300 hover:text-blue-200 font-mono"
                    >
                      {stats.merchantWallet.address}
                    </a>
                  </div>
                  <div className="text-right">
                    <p className="text-sm text-zinc-400 mb-1">On-Chain Balance</p>
                    <p className="text-2xl font-bold text-green-400">
                      ${formatBalance(stats.onChainBalance)} <span className="text-sm font-normal text-zinc-500">USDC</span>
                    </p>
                  </div>
                </div>
              </div>
            )}

            {!stats?.merchantWallet && (
              <div className="rounded-xl bg-yellow-900/20 border border-yellow-800/50 p-6">
                <p className="text-yellow-400 font-medium">No merchant wallet configured</p>
                <p className="text-sm text-zinc-400 mt-1">
                  Create a wallet using <code className="bg-zinc-800 px-1 rounded">arc_create_wallet</code> MCP tool
                </p>
              </div>
            )}

            {/* Articles Table */}
            <div className="rounded-xl bg-zinc-900 border border-zinc-800 overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-zinc-800 text-left text-sm text-zinc-500">
                    <th className="px-6 py-4 font-medium">Article</th>
                    <th className="px-6 py-4 font-medium">Endpoint</th>
                    <th className="px-6 py-4 font-medium text-right">Price</th>
                    <th className="px-6 py-4 font-medium text-right">Sales</th>
                    <th className="px-6 py-4 font-medium text-right">Revenue</th>
                    <th className="px-6 py-4 font-medium text-right">Last Sale</th>
                  </tr>
                </thead>
                <tbody>
                  {articles
                    .map((article) => {
                      const articleStat = stats?.articleStats.find(s => s.slug === article.slug)
                      const lastPayment = stats?.recentPayments.find(p => p.slug === article.slug)
                      return {
                        ...article,
                        sales: articleStat?.views || 0,
                        revenue: articleStat?.revenue || 0,
                        lastSale: lastPayment?.timestamp || null,
                      }
                    })
                    .sort((a, b) => b.sales - a.sales)
                    .map((article) => (
                      <tr key={article.slug} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                        <td className="px-6 py-4">
                          <p className="font-medium">{article.title}</p>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-2">
                            <code className="text-sm text-zinc-400">
                              {baseUrl}/api/article/{article.slug}
                            </code>
                            <button
                              onClick={() => copyToClipboard(`${baseUrl}/api/article/${article.slug}`, article.slug)}
                              className="text-zinc-500 hover:text-blue-400 transition-colors cursor-pointer"
                              title="Copy URL"
                            >
                              {copiedSlug === article.slug ? <CheckIcon /> : <CopyIcon />}
                            </button>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <span className="text-green-400">${article.priceUsd}</span>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <span className={article.sales > 0 ? 'text-blue-400' : 'text-zinc-600'}>
                            {article.sales}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <span className={article.revenue > 0 ? 'text-green-400' : 'text-zinc-600'}>
                            ${article.revenue.toFixed(2)}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-right text-sm text-zinc-500">
                          {article.lastSale ? formatTime(article.lastSale) : '—'}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>

            {/* Recent Payments */}
            <div className="rounded-xl bg-zinc-900 border border-zinc-800 p-6">
              <h2 className="text-lg font-semibold mb-4">Recent Payments</h2>
              {stats?.recentPayments && stats.recentPayments.length > 0 ? (
                <div className="space-y-3">
                  {stats.recentPayments.map((payment, idx) => {
                    const articleStat = stats.articleStats.find(a => a.slug === payment.slug)
                    const title = articleStat?.title || payment.slug
                    return (
                      <div
                        key={idx}
                        className="flex items-center justify-between p-3 rounded-lg bg-zinc-800/50"
                      >
                        <div className="flex-1 min-w-0">
                          <p className="font-medium truncate">{title}</p>
                          <div className="flex items-center gap-2 text-xs text-zinc-500">
                            {payment.txHash ? (
                              <a
                                href={`https://testnet.arcscan.app/tx/${payment.txHash}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-blue-400 hover:text-blue-300 font-mono"
                              >
                                {payment.txHash.slice(0, 10)}...{payment.txHash.slice(-6)}
                              </a>
                            ) : (
                              <span className="font-mono">pending</span>
                            )}
                            <span>•</span>
                            <span>{formatTime(payment.timestamp)}</span>
                          </div>
                        </div>
                        <div className="text-right ml-4">
                          <p className="text-green-400 font-medium">
                            +${payment.amount.toFixed(2)}
                          </p>
                        </div>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div className="text-center py-8 text-zinc-600">
                  <p className="text-4xl mb-2">💳</p>
                  <p>No payments yet</p>
                  <p className="text-sm mt-1">
                    Waiting for AI agents to access content...
                  </p>
                </div>
              )}
            </div>

            {/* Buyer Agent */}
            <div className="rounded-xl bg-zinc-900 border border-zinc-800 p-6">
              <h2 className="text-lg font-semibold mb-4">Buyer Agent</h2>
              <p className="text-sm text-zinc-500 mb-4">
                Chat with an AI agent that can pay for content autonomously.
              </p>

              {/* Chat Messages */}
              <div className="h-80 overflow-y-auto overflow-x-hidden mb-4 space-y-3 p-3 bg-zinc-800/30 rounded-lg">
                {messages.length === 0 ? (
                  <div className="text-center text-zinc-500 text-sm py-8">
                    <p>Start a conversation with the buyer agent.</p>
                    <p className="mt-1">Try: &quot;Pay for {baseUrl}/api/article/x402-micropayments&quot;</p>
                  </div>
                ) : (
                  messages.map((msg) => (
                    <div
                      key={msg.id}
                      className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                    >
                      <div
                        className={`max-w-[80%] rounded-lg px-4 py-2 text-sm break-words overflow-hidden ${
                          msg.role === 'user'
                            ? 'bg-blue-600 text-white'
                            : 'bg-zinc-700 text-zinc-100'
                        }`}
                      >
                        {msg.parts.map((part, idx) => {
                          switch (part.type) {
                            case 'text':
                              return (
                                <div key={idx}>
                                  <ReactMarkdown
                                    remarkPlugins={[remarkGfm]}
                                    components={{
                                      a: (props) => (
                                        <a {...props} className="text-blue-400 hover:underline" target="_blank" rel="noopener noreferrer" />
                                      ),
                                      code: ({ inline, ...props }: any) => (
                                        inline ?
                                          <code {...props} className="bg-zinc-800 px-1 py-0.5 rounded text-sm" /> :
                                          <code {...props} className="block bg-zinc-800 p-2 rounded text-sm overflow-x-auto my-2" />
                                      ),
                                      h1: (props) => <h1 {...props} className="text-xl font-bold mt-3 mb-2" />,
                                      h2: (props) => <h2 {...props} className="text-lg font-bold mt-3 mb-2" />,
                                      h3: (props) => <h3 {...props} className="text-base font-bold mt-2 mb-1" />,
                                      ul: (props) => <ul {...props} className="list-disc ml-4 my-2" />,
                                      ol: (props) => <ol {...props} className="list-decimal ml-4 my-2" />,
                                      p: (props) => <p {...props} className="my-2" />,
                                    }}
                                  >
                                    {part.text}
                                  </ReactMarkdown>
                                </div>
                              )
                            case 'step-start':
                              return null
                            case 'dynamic-tool':
                              return (
                                <div key={idx} className="text-xs text-zinc-400 my-1 p-2 bg-zinc-800 rounded">
                                  <span className="text-blue-400">{part.toolName}</span>
                                  {part.state === 'input-streaming' && (
                                    <span className="ml-2 text-zinc-500">streaming...</span>
                                  )}
                                  {part.state === 'input-available' && (
                                    <span className="ml-2 text-zinc-500">running...</span>
                                  )}
                                  {part.state === 'output-available' && (
                                    <pre className="mt-1 overflow-x-auto max-h-32">
                                      {JSON.stringify(part.output, null, 2)}
                                    </pre>
                                  )}
                                  {part.state === 'output-error' && (
                                    <span className="ml-2 text-red-400">Error: {part.errorText}</span>
                                  )}
                                </div>
                              )
                            default:
                              return null
                          }
                        })}
                      </div>
                    </div>
                  ))
                )}
                {status === 'streaming' && (
                  <div className="flex justify-start">
                    <div className="bg-zinc-700 text-zinc-400 rounded-lg px-4 py-2 text-sm animate-pulse">
                      Thinking...
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Input + Button */}
              <form onSubmit={(e) => { e.preventDefault(); runBuyerAgent(); }} className="flex gap-3">
                <input
                  type="text"
                  value={agentInput}
                  onChange={(e) => setAgentInput(e.target.value)}
                  placeholder="Ask the agent to pay for content..."
                  className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-2 text-white placeholder-zinc-500 focus:outline-none focus:border-blue-500"
                  disabled={status !== 'ready'}
                />
                <button
                  type="submit"
                  disabled={status !== 'ready' || !agentInput.trim()}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-zinc-700 disabled:cursor-not-allowed rounded-lg text-white font-medium transition-colors"
                >
                  {status !== 'ready' ? 'Sending...' : 'Send'}
                </button>
              </form>
            </div>

          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-zinc-800 p-4 mt-8">
        <div className="mx-auto max-w-6xl text-center text-sm text-zinc-600">
          Powered by Arc · Circle · x402
        </div>
      </footer>
    </div>
  )
}
