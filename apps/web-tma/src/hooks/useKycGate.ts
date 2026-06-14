import { useCallback, useEffect, useState } from 'react'
import { fetchKycStatus } from '@/api/kyc'

export function useKycGate(active: boolean) {
  const [kycApproved, setKycApproved] = useState<boolean | null>(null)
  const [kycOpen, setKycOpen] = useState(false)

  const refreshKyc = useCallback(() => {
    return fetchKycStatus()
      .then((s) => {
        const approved = s.status === 'approved'
        setKycApproved(approved)
        return approved
      })
      .catch(() => {
        setKycApproved(null)
        return false
      })
  }, [])

  useEffect(() => {
    if (!active) return
    void refreshKyc()
  }, [active, refreshKyc])

  const onKycClose = useCallback(() => {
    setKycOpen(false)
    void refreshKyc()
  }, [refreshKyc])

  const onKycApproved = useCallback(() => {
    setKycApproved(true)
  }, [])

  return {
    kycApproved,
    kycOpen,
    setKycOpen,
    refreshKyc,
    onKycClose,
    onKycApproved,
  }
}
