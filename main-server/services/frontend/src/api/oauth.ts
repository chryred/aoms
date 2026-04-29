import { adminApi } from '@/lib/ky-client'

export interface OAuthClientOut {
  id: number
  client_id: string
  name: string
  redirect_uris: string[]
  is_active: boolean
  created_at: string
}

export interface OAuthClientCreated extends OAuthClientOut {
  client_secret: string
  warning: string
}

export const oauthApi = {
  listClients: () => adminApi.get('api/v1/oauth/clients').json<OAuthClientOut[]>(),

  createClient: (data: { name: string; redirect_uris: string[] }) =>
    adminApi.post('api/v1/oauth/clients', { json: data }).json<OAuthClientCreated>(),

  deactivateClient: (id: number) => adminApi.delete(`api/v1/oauth/clients/${id}`),

  authorize: (data: {
    email: string
    password: string
    client_id: string
    redirect_uri: string
    scope: string
    state?: string
    nonce?: string
  }) => adminApi.post('oauth/authorize', { json: data }).json<{ redirect_url: string }>(),
}
