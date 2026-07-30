import { ReactNode } from 'react'

import Header from './Header'
import Sidebar from './Sidebar'

import { AppPage } from '../App'

type Props = {
  children: ReactNode
  currentPage: AppPage
  onNavigate: (page: AppPage) => void
}

export default function Layout({
  children,
  currentPage,
  onNavigate
}: Props) {
  return (
    <main className="layout">

      <Sidebar
        currentPage={currentPage}
        onNavigate={onNavigate}
      />

      <section className="workspace">

        <Header />

        {children}

      </section>

    </main>
  )
}