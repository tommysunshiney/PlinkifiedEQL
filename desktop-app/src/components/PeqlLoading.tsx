type Props = {
  title: string
  stage: string
  detail?: string
}

export default function PeqlLoading({ title, stage, detail }: Props) {
  return (
    <div className="peql-loading" role="status" aria-live="polite">
      <div className="peql-loading-header">
        <strong>{title}</strong>
        <span>{stage}</span>
      </div>
      <div className="peql-loading-track" aria-hidden="true">
        <div className="peql-loading-bar" />
      </div>
      {detail && <small>{detail}</small>}
    </div>
  )
}
