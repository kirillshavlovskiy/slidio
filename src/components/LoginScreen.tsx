'use client'
import { useState } from 'react'
import { signIn } from 'next-auth/react'

export default function LoginScreen() {
  const [devEmail, setDevEmail] = useState('')

  const devSignIn = (email: string) =>
    signIn('dev', { email, callbackUrl: '/app' })

  return (
    <div className="flex h-screen items-center justify-center bg-[#060d1a]">
      <div className="w-80 text-center space-y-6">
        <div className="flex justify-center">
          <div className="w-16 h-16 rounded-2xl bg-[#0d1b2a] border border-[#1e3a5f] flex items-center justify-center">
            <svg className="w-8 h-8 text-violet-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
          </div>
        </div>
        <div>
          <h1 className="text-2xl font-bold text-white">Slidio</h1>
          <p className="text-sm text-[#64748B] mt-1">AI-powered presentation editor</p>
        </div>
        <div className="space-y-3 text-xs text-[#475569] text-left bg-[#0d1b2a] border border-[#1e3a5f] rounded-xl p-4">
          <div className="flex items-center gap-2">
            <span className="text-violet-400">🧠</span> Persistent knowledge layers
          </div>
          <div className="flex items-center gap-2">
            <span className="text-blue-400">📸</span> Version control with restore
          </div>
          <div className="flex items-center gap-2">
            <span className="text-green-400">✦</span> AI-powered editing
          </div>
        </div>
        <button
          onClick={() => signIn('google', { callbackUrl: '/app' })}
          className="w-full flex items-center justify-center gap-3 bg-white text-gray-800 font-semibold text-sm py-3 rounded-xl hover:bg-gray-100 transition-colors"
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
          </svg>
          Continue with Google
        </button>

        {process.env.NODE_ENV !== 'production' && (
          <div className="space-y-2">
            <input
              value={devEmail}
              onChange={e => setDevEmail(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && devEmail.trim()) devSignIn(devEmail.trim()) }}
              placeholder="dev email (e.g. alice@local.test)"
              className="w-full bg-[#0d1b2a] border border-[#334155] rounded-xl px-3 py-2 text-xs text-[#e2e8f0] placeholder:text-[#475569] outline-none focus:border-violet-500"
            />
            <button
              onClick={() => devSignIn(devEmail.trim() || 'dev@local.test')}
              className="w-full flex items-center justify-center gap-2 bg-[#1e3a5f] text-[#cbd5e1] font-medium text-xs py-2.5 rounded-xl hover:bg-[#2a4a6f] hover:text-white transition-colors border border-[#334155]"
            >
              <span className="text-[#fbbf24]">⚡</span>
              {devEmail.trim() ? `Sign in as ${devEmail.trim()}` : 'Continue as Dev User (localhost)'}
            </button>
            <div className="flex gap-2">
              {['alice@local.test', 'bob@local.test'].map(e => (
                <button
                  key={e}
                  type="button"
                  onClick={() => devSignIn(e)}
                  className="flex-1 text-[10px] py-1.5 rounded-lg bg-[#0d1b2a] border border-[#334155] text-[#94a3b8] hover:text-white hover:border-[#60a5fa] transition-colors"
                >
                  {e.split('@')[0]}
                </button>
              ))}
            </div>
          </div>
        )}

        <p className="text-[10px] text-[#334155]">Your data is private and tied to your account.</p>
      </div>
    </div>
  )
}
