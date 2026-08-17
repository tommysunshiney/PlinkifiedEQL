import { useState } from 'react'

import Layout from './components/Layout'

import DashboardPage from './pages/DashboardPage'
import AdventureJournalPage from './pages/AdventureJournalPage'
import LiveLogPage from './pages/LiveLogPage'
import ParserLabPage from './pages/ParserLabPage'
import StatisticsPage from './pages/StatisticsPage'
import TimersPage from './pages/TimersPage'
import SettingsPage from './pages/SettingsPage'
import PageErrorBoundary from './components/PageErrorBoundary'

export type AppPage =
  | 'dashboard'
  | 'journal'
  | 'livelog'
  | 'parser'
  | 'statistics'
  | 'timers'
  | 'settings'

export default function App() {
  const [page, setPage] =
    useState<AppPage>('dashboard')

  function renderPage() {
    switch (page) {
      case 'dashboard':
        return <DashboardPage />

      case 'journal':
        return <AdventureJournalPage />

      case 'livelog':
        return <LiveLogPage />

      case 'parser':
        return <ParserLabPage />

      case 'statistics':
        return <StatisticsPage />

      case 'timers':
        return <TimersPage />

      case 'settings':
        return <SettingsPage />

      default:
        return <DashboardPage />
    }
  }

  return (
    <Layout
      currentPage={page}
      onNavigate={setPage}
    >
      <PageErrorBoundary key={page}>
        {renderPage()}
      </PageErrorBoundary>
    </Layout>
  )
}
