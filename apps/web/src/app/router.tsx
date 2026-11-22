import { createBrowserRouter } from 'react-router';
import { AppLayout } from '../layouts/AppLayout';
import { LandingPage } from '../pages/LandingPage';
import { NotFoundPage } from '../pages/NotFoundPage';

export const router = createBrowserRouter([
  {
    element: <AppLayout />,
    children: [
      { path: '/', element: <LandingPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);
