import { AppPage } from '../App'

type Props = {
  currentPage: AppPage
  onNavigate: (page: AppPage) => void
}

export default function Sidebar({
  currentPage,
  onNavigate
}: Props) {
  return (
    <aside className="sidebar">

      <button
        className={currentPage === 'dashboard'
          ? 'active'
          : ''}
        onClick={() => onNavigate('dashboard')}
      >
        🏠 Dashboard
      </button>

      <button
        className={currentPage === 'journal'
          ? 'active'
          : ''}
        onClick={() => onNavigate('journal')}
      >
        📖 Adventure Journal
      </button>

      <button
        className={currentPage === 'livelog'
          ? 'active'
          : ''}
        onClick={() => onNavigate('livelog')}
      >
        📜 Live Log
      </button>

      <button
        className={currentPage === 'parser'
          ? 'active'
          : ''}
        onClick={() => onNavigate('parser')}
      >
        🧪 Parser Lab
      </button>

      <button
        className={currentPage === 'statistics'
          ? 'active'
          : ''}
        onClick={() => onNavigate('statistics')}
      >
        📈 Statistics
      </button>

      <button
        className={currentPage === 'settings'
          ? 'active'
          : ''}
        onClick={() => onNavigate('settings')}
      >
        ⚙ Settings
      </button>

    </aside>
  )
}