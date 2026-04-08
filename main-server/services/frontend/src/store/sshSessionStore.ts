import { create } from 'zustand'

interface SSHSessionState {
  token: string | null
  host: string | null
  port: number | null
  username: string | null
  expiresAt: number | null // Unix timestamp (ms)
  setSession: (token: string, host: string, port: number, username: string, expiresIn: number) => void
  clearSession: () => void
  isValid: () => boolean
}

export const useSSHSessionStore = create<SSHSessionState>((set, get) => ({
  token: null,
  host: null,
  port: null,
  username: null,
  expiresAt: null,

  setSession: (token, host, port, username, expiresIn) => {
    set({
      token,
      host,
      port,
      username,
      expiresAt: Date.now() + expiresIn * 1000,
    })
  },

  clearSession: () => set({ token: null, host: null, port: null, username: null, expiresAt: null }),

  isValid: () => {
    const { token, expiresAt } = get()
    return !!token && !!expiresAt && Date.now() < expiresAt
  },
}))
