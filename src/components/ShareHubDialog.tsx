'use client'

import { useEffect, useState, useCallback } from 'react'
import { X, UserPlus, Crown, Pencil, Eye, Loader2, Mail, Trash2 } from 'lucide-react'
import type { HubRole, HubMemberInfo, HubInviteInfo } from '@/lib/types'
import { Button } from '@/components/ui/button'

interface Props {
  hubId: string
  hubName: string
  onClose: () => void
}

const ROLE_META: Record<HubRole, { label: string; Icon: React.ComponentType<{ className?: string }>; desc: string }> = {
  owner: { label: 'Owner', Icon: Crown, desc: 'Manage members + edit' },
  editor: { label: 'Editor', Icon: Pencil, desc: 'Edit decks & knowledge' },
  viewer: { label: 'Viewer', Icon: Eye, desc: 'Read-only' },
}

export default function ShareHubDialog({ hubId, hubName, onClose }: Props) {
  const [members, setMembers] = useState<HubMemberInfo[]>([])
  const [invites, setInvites] = useState<HubInviteInfo[]>([])
  const [myRole, setMyRole] = useState<HubRole | null>(null)
  const [loading, setLoading] = useState(true)
  const [email, setEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<HubRole>('editor')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/hubs/${hubId}/members`)
      const data = await res.json()
      if (res.ok) {
        setMembers(data.members ?? [])
        setInvites(data.invites ?? [])
        setMyRole(data.myRole ?? null)
      } else {
        setError(data.error || 'Failed to load members')
      }
    } catch {
      setError('Failed to load members')
    } finally {
      setLoading(false)
    }
  }, [hubId])

  useEffect(() => { load() }, [load])

  const isOwner = myRole === 'owner'

  const invite = async () => {
    const e = email.trim().toLowerCase()
    if (!e) return
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const res = await fetch(`/api/hubs/${hubId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: e, role: inviteRole }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Invite failed')
        return
      }
      setNotice(data.added ? `Added ${e}` : `Invited ${e} — they'll join on first sign-in`)
      setEmail('')
      await load()
    } finally {
      setBusy(false)
    }
  }

  const changeRole = async (userId: string, role: HubRole) => {
    setError(null)
    const res = await fetch(`/api/hubs/${hubId}/members`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, role }),
    })
    if (!res.ok) {
      const d = await res.json().catch(() => ({}))
      setError(d.error || 'Could not change role')
    }
    await load()
  }

  const removeMember = async (userId: string) => {
    setError(null)
    const res = await fetch(`/api/hubs/${hubId}/members`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId }),
    })
    if (!res.ok) {
      const d = await res.json().catch(() => ({}))
      setError(d.error || 'Could not remove')
    }
    await load()
  }

  const revokeInvite = async (inviteId: string) => {
    await fetch(`/api/hubs/${hubId}/members`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inviteId }),
    })
    await load()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-16 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="w-[520px] max-h-[80vh] bg-[#0d1b2a] border border-[#1e3a5f] rounded-xl shadow-2xl flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#1e3a5f]">
          <div>
            <p className="text-sm font-bold text-white">Share “{hubName}”</p>
            <p className="text-xs text-[#64748B] mt-0.5">Invite people to collaborate in this Knowledge Hub</p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}><X className="w-4 h-4" /></Button>
        </div>

        {isOwner && (
          <div className="px-5 py-3 border-b border-[#1e3a5f] space-y-2">
            <div className="flex gap-2">
              <input
                value={email}
                onChange={e => setEmail(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') invite() }}
                placeholder="Invite by email…"
                className="flex-1 bg-[#112236] border border-[#1e3a5f] rounded px-3 py-2 text-sm text-white placeholder-[#475569] outline-none focus:border-violet-500"
              />
              <select
                value={inviteRole}
                onChange={e => setInviteRole(e.target.value as HubRole)}
                className="bg-[#112236] border border-[#1e3a5f] rounded px-2 text-xs text-white outline-none focus:border-violet-500"
              >
                <option value="editor">Editor</option>
                <option value="viewer">Viewer</option>
              </select>
              <Button onClick={invite} disabled={busy || !email.trim()} variant="default" size="md">
                {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UserPlus className="w-3.5 h-3.5" />}
                Invite
              </Button>
            </div>
            {error && <p className="text-[11px] text-[#F87171]">{error}</p>}
            {notice && <p className="text-[11px] text-green-400">{notice}</p>}
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-5 py-3 space-y-1.5">
          {loading ? (
            <div className="flex items-center gap-2 text-xs text-[#64748B] py-6 justify-center">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading members…
            </div>
          ) : (
            <>
              <p className="text-[10px] font-bold tracking-wider uppercase text-[#475569] mb-1">
                Members ({members.length})
              </p>
              {members.map(m => {
                const Meta = ROLE_META[m.role]
                return (
                  <div key={m.id} className="flex items-center gap-3 rounded-lg border border-[#1e3a5f] bg-[#112236] px-3 py-2">
                    <div className="w-7 h-7 rounded-full bg-violet-500/20 border border-violet-500/30 flex items-center justify-center text-xs font-bold text-violet-300">
                      {(m.name || m.email || '?').charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold text-white truncate">
                        {m.name || m.email}{m.isMe && <span className="text-[#64748B] font-normal"> (you)</span>}
                      </p>
                      <p className="text-[10px] text-[#64748B] truncate">{m.email}</p>
                    </div>
                    {isOwner && !m.isMe ? (
                      <select
                        value={m.role}
                        onChange={e => changeRole(m.userId, e.target.value as HubRole)}
                        className="bg-[#0d1b2a] border border-[#1e3a5f] rounded px-1.5 py-1 text-[11px] text-white outline-none focus:border-violet-500"
                      >
                        <option value="owner">Owner</option>
                        <option value="editor">Editor</option>
                        <option value="viewer">Viewer</option>
                      </select>
                    ) : (
                      <span className="flex items-center gap-1 text-[11px] text-[#94a3b8]">
                        <Meta.Icon className="w-3 h-3" /> {Meta.label}
                      </span>
                    )}
                    {isOwner && !m.isMe && (
                      <Button variant="ghost" size="icon" title="Remove" onClick={() => removeMember(m.userId)} className="hover:text-[#F87171]">
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    )}
                  </div>
                )
              })}

              {invites.length > 0 && (
                <>
                  <p className="text-[10px] font-bold tracking-wider uppercase text-[#475569] mt-3 mb-1">
                    Pending invites ({invites.length})
                  </p>
                  {invites.map(i => (
                    <div key={i.id} className="flex items-center gap-3 rounded-lg border border-dashed border-[#1e3a5f] bg-[#0a1220] px-3 py-2">
                      <div className="w-7 h-7 rounded-full bg-[#1e3a5f] flex items-center justify-center">
                        <Mail className="w-3.5 h-3.5 text-[#64748B]" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs text-[#CBD5E1] truncate">{i.email}</p>
                        <p className="text-[10px] text-[#475569]">Pending · {i.role}</p>
                      </div>
                      {isOwner && (
                        <Button variant="ghost" size="sm" onClick={() => revokeInvite(i.id)} className="hover:text-[#F87171]">
                          Revoke
                        </Button>
                      )}
                    </div>
                  ))}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
