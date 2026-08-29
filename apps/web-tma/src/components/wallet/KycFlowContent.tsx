import { useTranslation } from 'react-i18next'
import { Check, Loader2, ShieldCheck, Upload } from 'lucide-react'
import FaceSelfieCapture from '@/components/wallet/FaceSelfieCapture'
import type { KycFlow, DocType } from '@/hooks/useKycFlow'

interface Props {
  flow: KycFlow
  /** 完成/复核中点击"关闭"的行为：弹窗=关闭，独立页=返回 */
  onClose: () => void
  compactFace?: boolean
}

/** 实名认证流程的步骤 UI（进度条 + 各步骤表单），提现弹窗与 KYC Setting 页共用。 */
export default function KycFlowContent({ flow, onClose, compactFace }: Props) {
  const { t } = useTranslation()
  const {
    step, requirePhone, requireDocument, requireFace, loading, error,
    phone, setPhone, phoneLocked, code, setCode, resendIn,
    docType, setDocType, idImage, docReuploadRequired, idInputRef,
    suggestDocRedo, backToDocument, docRedoMode, prevDocImage, continueToFace,
    onSendCode, onVerifyCode, onPickImage, onSubmitDoc, onSubmitFace,
  } = flow

  const inputCls = 'w-full rounded-xl border border-border bg-secondary px-4 py-3 text-sm font-bold text-foreground focus:border-primary focus:outline-none'

  return (
    <>
      <div className="mb-1 flex items-center gap-2">
        <ShieldCheck size={20} className="text-primary" />
        <h2 className={`${compactFace && step === 'face' ? 'text-base' : 'text-lg'} font-black text-foreground`}>{t('kyc.title')}</h2>
      </div>
      <p className="mb-2 text-xs text-muted-foreground">{t('kyc.subtitle')}</p>
      <p className={`${compactFace && step === 'face' ? 'mb-3' : 'mb-5'} rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-[10px] font-semibold leading-relaxed text-muted-foreground`}>
        {t('kyc.purposeNotice')}
      </p>

      <div className={`${compactFace && step === 'face' ? 'mb-3' : 'mb-5'} flex items-center gap-1 text-[10px] font-bold`}>
        {requirePhone && (
          <span className={step === 'phone' ? 'text-primary' : ['document', 'reviewing', 'face', 'done'].includes(step) ? 'text-emerald-400' : 'text-muted-foreground'}>
            {t('kyc.stepPhone')}
          </span>
        )}
        {requireDocument && (
          <>
            {requirePhone && <span className="h-px w-2 bg-border" />}
            <span className={['document', 'reviewing'].includes(step) ? 'text-primary' : ['face', 'done'].includes(step) ? 'text-emerald-400' : 'text-muted-foreground'}>
              {t('kyc.stepDocument')}
            </span>
          </>
        )}
        {requireFace && (
          <>
            <span className="h-px w-2 bg-border" />
            <span className={step === 'face' ? 'text-primary' : step === 'done' ? 'text-emerald-400' : 'text-muted-foreground'}>
              {t('kyc.stepFace')}
            </span>
          </>
        )}
      </div>

      {step === 'phone' && (
        <div className="space-y-3">
          <div className="flex gap-2">
            <input value={phone} type="tel" placeholder={t('auth.phonePlaceholder')} className={`flex-1 rounded-xl border border-border bg-secondary px-4 py-3 text-sm font-bold text-foreground focus:border-primary focus:outline-none${phoneLocked ? ' opacity-60' : ''}`} readOnly={phoneLocked} onChange={(e) => setPhone(e.target.value)} />
            <button type="button" className="shrink-0 rounded-xl border border-border bg-secondary px-4 py-3 text-sm font-bold text-foreground disabled:opacity-50" disabled={loading || resendIn > 0} onClick={() => void onSendCode()}>
              {resendIn > 0 ? t('kyc.resendIn', { s: resendIn }) : t('kyc.sendCode')}
            </button>
          </div>
          {phoneLocked && <p className="text-[10px] text-muted-foreground">{t('kyc.phoneLocked')}</p>}
          <input value={code} type="text" inputMode="numeric" maxLength={6} placeholder={t('kyc.codeLabel')} className={inputCls} onChange={(e) => setCode(e.target.value)} />
          <button type="button" className="w-full rounded-xl bg-primary py-3 text-sm font-bold text-primary-foreground disabled:opacity-50" disabled={loading} onClick={() => void onVerifyCode()}>
            {loading ? <Loader2 size={16} className="mx-auto animate-spin" /> : t('kyc.verify')}
          </button>
        </div>
      )}

      {step === 'document' && (
        <div className="space-y-3">
          <select value={docType} className={inputCls} onChange={(e) => setDocType(e.target.value as DocType)}>
            <option value="ktp">{t('kyc.docKtp')}</option>
            <option value="sim">{t('kyc.docSim')}</option>
            <option value="philid">{t('kyc.docPhilid')}</option>
            <option value="passport">{t('kyc.docPassport')}</option>
            <option value="drivers_license">{t('kyc.docDriversLicense')}</option>
            <option value="umid">{t('kyc.docUmid')}</option>
            <option value="acr_icard">{t('kyc.docAcrIcard')}</option>
          </select>

          {docRedoMode && !idImage && (
            <>
              {prevDocImage && <img src={prevDocImage} alt="id" className="max-h-32 w-full rounded-xl object-contain" />}
              <p className="text-[10px] text-muted-foreground">{t('kyc.redoDocChoiceHint')}</p>
            </>
          )}

          <input ref={idInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => void onPickImage(e.target.files?.[0])} />
          <button type="button" className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-secondary py-3 text-sm font-bold text-foreground" onClick={() => idInputRef.current?.click()}>
            {idImage ? <Check size={16} className="text-emerald-400" /> : <Upload size={16} />}
            {idImage ? `${t('kyc.uploadId')} ✓` : docReuploadRequired || docRedoMode ? t('kyc.reuploadId') : t('kyc.uploadId')}
          </button>
          {idImage && <img src={idImage} alt="id" className="max-h-32 w-full rounded-xl object-contain" />}

          {docRedoMode && !idImage ? (
            <button type="button" className="w-full rounded-xl bg-primary py-3 text-sm font-bold text-primary-foreground" onClick={continueToFace}>
              {t('kyc.redoDocContinueFace')}
            </button>
          ) : (
            <button type="button" className="w-full rounded-xl bg-primary py-3 text-sm font-bold text-primary-foreground disabled:opacity-50" disabled={loading || !idImage} onClick={() => void onSubmitDoc()}>
              {loading ? t('kyc.reviewing') : t('kyc.submit')}
            </button>
          )}
        </div>
      )}

      {step === 'reviewing' && (
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/15">
            <ShieldCheck size={28} className="text-primary animate-pulse" />
          </div>
          <p className="text-sm font-black text-foreground">{t('kyc.reviewing')}</p>
          <p className="text-xs text-muted-foreground">{t('kyc.reviewingHint')}</p>
          <button type="button" className="mt-2 w-full rounded-xl bg-primary py-3 text-sm font-bold text-primary-foreground" onClick={onClose}>
            {t('kyc.close')}
          </button>
        </div>
      )}

      {step === 'face' && (
        <>
          <FaceSelfieCapture loading={loading} compact={compactFace} onComplete={(selfie) => void onSubmitFace(selfie)} />
          {suggestDocRedo && (
            <button type="button" className="mt-3 w-full text-center text-xs font-bold text-primary underline" onClick={() => void backToDocument()}>
              {t('kyc.redoDocEntry')}
            </button>
          )}
        </>
      )}

      {step === 'done' && (
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500/15">
            <Check size={28} className="text-emerald-400" />
          </div>
          <p className="text-sm font-black text-foreground">{t('kyc.approved')}</p>
          <button type="button" className="mt-2 w-full rounded-xl bg-primary py-3 text-sm font-bold text-primary-foreground" onClick={onClose}>
            {t('kyc.close')}
          </button>
        </div>
      )}

      {error && <p className="mt-3 text-center text-xs text-red-400">{error}</p>}
    </>
  )
}
