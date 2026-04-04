import { adminApi } from '@/lib/ky-client'
import type { Contact, ContactCreate, SystemContact, SystemContactCreate } from '@/types/contact'

export const contactsApi = {
  getContacts: () =>
    adminApi.get('api/v1/contacts').json<Contact[]>(),

  getContact: (id: number) =>
    adminApi.get(`api/v1/contacts/${id}`).json<Contact>(),

  createContact: (body: ContactCreate) =>
    adminApi.post('api/v1/contacts', { json: body }).json<Contact>(),

  updateContact: (id: number, body: Partial<ContactCreate>) =>
    adminApi.patch(`api/v1/contacts/${id}`, { json: body }).json<Contact>(),

  deleteContact: (id: number) =>
    adminApi.delete(`api/v1/contacts/${id}`),

  getSystemContacts: (systemId: number) =>
    adminApi.get(`api/v1/systems/${systemId}/contacts`).json<SystemContact[]>(),

  addSystemContact: (systemId: number, body: SystemContactCreate) =>
    adminApi.post(`api/v1/systems/${systemId}/contacts`, { json: body }).json<SystemContact>(),

  removeSystemContact: (systemId: number, contactId: number) =>
    adminApi.delete(`api/v1/systems/${systemId}/contacts/${contactId}`),
}
