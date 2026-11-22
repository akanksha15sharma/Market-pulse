import { createBrowserRouter } from 'react-router';
import { WatchlistsPage } from '../pages/WatchlistsPage';
import {
  watchlistsAction,
  watchlistsLoader,
} from '../features/watchlists/actions';
import { AppLayout } from '../layouts/AppLayout';
import { MarketDashboardPage } from '../pages/MarketDashboardPage';
import { AssetDetailPage } from '../pages/AssetDetailPage';
import { NotFoundPage } from '../pages/NotFoundPage';
import { LoginPage } from '../pages/LoginPage';
import { RegisterPage } from '../pages/RegisterPage';
import { AccountPage } from '../pages/AccountPage';
import { ForgotPasswordPage } from '../pages/ForgotPasswordPage';
import { ResetPasswordPage } from '../pages/ResetPasswordPage';
import { VerifyEmailPage } from '../pages/VerifyEmailPage';
import { RouteErrorPage } from '../pages/RouteErrorPage';
import { accountLoader } from '../features/auth/loaders';
export const router = createBrowserRouter([
  {
    element: <AppLayout />,
    errorElement: <RouteErrorPage />,
    children: [
      { path: '/', element: <MarketDashboardPage /> },
      { path: '/markets', element: <MarketDashboardPage /> },
      { path: '/assets/:id', element: <AssetDetailPage /> },
      { path: '/login', element: <LoginPage /> },
      { path: '/register', element: <RegisterPage /> },
      { path: '/forgot-password', element: <ForgotPasswordPage /> },
      { path: '/reset-password', element: <ResetPasswordPage /> },
      { path: '/verify-email', element: <VerifyEmailPage /> },
      {
        path: '/watchlists',
        loader: watchlistsLoader,
        action: watchlistsAction,
        element: <WatchlistsPage />,
      },
      { path: '/account', loader: accountLoader, element: <AccountPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);
