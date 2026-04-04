import { create } from 'zustand'
import type { WizardState, CollectorType } from '@/types/collectorConfig'

export const useWizardStore = create<WizardState>((set) => ({
  systemId: null,
  step: 1,
  collectorType: null,
  selectedMetricGroups: [],
  customMetricGroup: '',
  prometheusJob: '',
  customConfig: '',

  setStep: (step) => set({ step }),
  setCollectorType: (type: CollectorType) =>
    set({ collectorType: type, selectedMetricGroups: [] }),
  toggleMetricGroup: (group) =>
    set((s) => ({
      selectedMetricGroups: s.selectedMetricGroups.includes(group)
        ? s.selectedMetricGroups.filter((g) => g !== group)
        : [...s.selectedMetricGroups, group],
    })),
  addCustomMetricGroup: (group) =>
    set((s) => ({
      selectedMetricGroups: s.selectedMetricGroups.includes(group)
        ? s.selectedMetricGroups
        : [...s.selectedMetricGroups, group],
      customMetricGroup: '',
    })),
  removeMetricGroup: (group) =>
    set((s) => ({
      selectedMetricGroups: s.selectedMetricGroups.filter((g) => g !== group),
    })),
  setPrometheusJob: (job) => set({ prometheusJob: job }),
  setCustomConfig: (config) => set({ customConfig: config }),
  reset: (systemId) =>
    set({
      systemId: systemId ?? null,
      step: 1,
      collectorType: null,
      selectedMetricGroups: [],
      customMetricGroup: '',
      prometheusJob: '',
      customConfig: '',
    }),
}))
