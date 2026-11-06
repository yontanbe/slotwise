import { useEffect } from 'react'
import { HashRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { AuthProvider, RequireAuth } from './auth/AuthProvider'
import { ToastProvider } from './components/ui'
import { StoreProvider } from './data/StoreProvider'
import { I18nProvider } from './i18n'
import { applyTheme } from './lib/theme'
import AppLayout from './pages/app/AppLayout'
import Availability from './pages/app/Availability'
import Bookings from './pages/app/Bookings'
import Contacts from './pages/app/Contacts'
import EventTypeEditor from './pages/app/EventTypeEditor'
import EventTypes from './pages/app/EventTypes'
import Home from './pages/app/Home'
import Insights from './pages/app/Insights'
import Integrations from './pages/app/Integrations'
import PollEditor from './pages/app/PollEditor'
import Polls from './pages/app/Polls'
import Settings from './pages/app/Settings'
import Landing from './pages/Landing'
import Login from './pages/Login'
import Onboarding from './pages/Onboarding'
import BookingPage from './pages/public/BookingPage'
import LinkPage from './pages/public/LinkPage'
import ManageBooking from './pages/public/ManageBooking'
import PollVote from './pages/public/PollVote'
import Profile from './pages/public/Profile'

function ScrollTop() {
  const { pathname } = useLocation()
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])
  return null
}

export default function App() {
  useEffect(() => {
    applyTheme()
  }, [])
  return (
    <I18nProvider>
      <StoreProvider>
        <ToastProvider>
          <HashRouter>
            <AuthProvider>
              <ScrollTop />
              <Routes>
                <Route path="/" element={<Landing />} />
                <Route path="/login" element={<Login />} />
                <Route
                  path="/onboarding"
                  element={
                    <RequireAuth allowNotOnboarded>
                      <Onboarding />
                    </RequireAuth>
                  }
                />
                <Route
                  path="/app"
                  element={
                    <RequireAuth>
                      <AppLayout />
                    </RequireAuth>
                  }
                >
                  <Route index element={<Home />} />
                  <Route path="event-types" element={<EventTypes />} />
                  <Route path="event-types/:id" element={<EventTypeEditor />} />
                  <Route path="availability" element={<Availability />} />
                  <Route path="availability/:id" element={<Availability />} />
                  <Route path="bookings" element={<Bookings />} />
                  <Route path="polls" element={<Polls />} />
                  <Route path="polls/:id" element={<PollEditor />} />
                  <Route path="contacts" element={<Contacts />} />
                  <Route path="insights" element={<Insights />} />
                  <Route path="integrations" element={<Integrations />} />
                  <Route path="settings" element={<Settings />} />
                  <Route path="*" element={<Navigate to="/app" replace />} />
                </Route>
                <Route path="/b/:token" element={<ManageBooking />} />
                <Route path="/p/:id" element={<PollVote />} />
                <Route path="/d/:token" element={<LinkPage />} />
                <Route path="/:username" element={<Profile />} />
                <Route path="/:username/:slug" element={<BookingPage />} />
              </Routes>
            </AuthProvider>
          </HashRouter>
        </ToastProvider>
      </StoreProvider>
    </I18nProvider>
  )
}
