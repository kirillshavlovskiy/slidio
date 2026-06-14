import NextAuth from 'next-auth'
import Google from 'next-auth/providers/google'
import Credentials from 'next-auth/providers/credentials'
import { PrismaAdapter } from '@auth/prisma-adapter'
import { prisma } from './prisma'

// Corporate proxies often MITM HTTPS with a self-signed cert, which breaks
// Google's OAuth discovery fetch (TypeError: fetch failed / SELF_SIGNED_CERT_IN_CHAIN).
if (
  process.env.NODE_ENV === 'development' &&
  process.env.AUTH_ALLOW_INSECURE_TLS === 'true'
) {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
}

const isDev = process.env.NODE_ENV !== 'production'

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  trustHost: true,
  // Credentials provider requires JWT sessions. This also works fine for Google.
  session: { strategy: 'jwt' },
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
    // Dev-only one-click login — no external redirect, works inside sandboxed
    // preview browsers that block accounts.google.com. Disabled in production.
    ...(isDev
      ? [
          Credentials({
            id: 'dev',
            name: 'Dev Login',
            credentials: {},
            async authorize() {
              const email = 'dev@local.test'
              const user = await prisma.user.upsert({
                where: { email },
                update: {},
                create: { email, name: 'Dev User' },
              })
              return { id: user.id, email: user.email, name: user.name }
            },
          }),
        ]
      : []),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user?.id) token.id = user.id
      return token
    },
    session({ session, token }) {
      if (session.user && token.id) session.user.id = token.id as string
      return session
    },
  },
  events: {
    // Fires exactly once, when the adapter creates a brand-new user row — i.e. a
    // registration. New users default to the "free" plan (see schema), so every
    // createUser is a free-plan signup until a Stripe webhook upgrades them.
    async createUser({ user }) {
      const record = {
        event: 'free_plan_registration',
        userId: user.id,
        email: user.email ?? null,
        name: user.name ?? null,
        at: new Date().toISOString(),
      }
      // Always logged — visible in `vercel logs` / the dev terminal.
      console.log('[registration]', JSON.stringify(record))

      // Optional: POST to a Slack/Discord/generic webhook if configured.
      const hook = process.env.SIGNUP_WEBHOOK_URL
      if (hook) {
        const message = `New free-plan registration: ${user.email ?? user.id}`
        try {
          await fetch(hook, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            // `text` satisfies Slack, `content` satisfies Discord; extra fields ignored.
            body: JSON.stringify({ text: message, content: message, ...record }),
          })
        } catch (err) {
          console.error('[registration] webhook POST failed:', err)
        }
      }
    },
  },
})
