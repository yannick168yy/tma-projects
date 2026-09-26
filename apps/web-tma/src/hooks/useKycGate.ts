import { useCallback, useEffect, useState } from 'react'
import { fetchKycStatus, isKycGatePassed, type KycStatus } from '@/api/kyc'

export function useKycGate(active: boolean, currency?: string) {
  const [kycApproved, setKycApproved] = useState<boolean | null>(null)
  const [kycOpen, setKycOpen] = useState(false)
  const [boundPhoneNumber, setBoundPhoneNumber] = useState<string | null>(null)
  const [kycFullName, setKycFullName] = useState<string | null>(null)

  const refreshKyc = useCallback((): Promise<KycStatus | null> => {
    return fetchKycStatus(currency)
      .then((s) => {
        const approved = isKycGatePassed(s)
        setKycApproved(approved)
        setBoundPhoneNumber(s.registeredPhone ?? s.phone ?? null)
        setKycFullName(s.fullName?.trim() || null)
        return s
      })
      .catch(() => {
        setKycApproved(null)
        setBoundPhoneNumber(null)
        setKycFullName(null)
        return null
      })
  }, [currency])

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
    void refreshKyc()
  }, [refreshKyc])

  return {
    kycApproved,
    kycOpen,
    setKycOpen,
    boundPhoneNumber,
    kycFullName,
    refreshKyc,
    onKycClose,
    onKycApproved,
  }
}
