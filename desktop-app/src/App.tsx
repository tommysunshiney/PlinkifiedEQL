import { useState } from 'react'

import Layout from './components/Layout'

import DashboardPage from './pages/DashboardPage'
import AdventureJournalPage from './pages/AdventureJournalPage'
import LiveLogPage from './pages/LiveLogPage'
import ParserLabPage from './pages/ParserLabPage'
import StatisticsPage from './pages/StatisticsPage'
import SettingsPage from './pages/SettingsPage'

export type AppPage =
  | 'dashboard'
  | 'journal'
  | 'livelog'
  | 'parser'
  | 'statistics'
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
      {renderPage()}
    </Layout>
  )
}