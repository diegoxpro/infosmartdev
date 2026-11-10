import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { AuthProvider } from './auth';
import { AutorizacionProvider } from './autorizacion';
import { ToastProvider } from './components/ui';
import { MarcaProvider } from './marca';
import './styles.css';
import './pos.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <ToastProvider>
        <MarcaProvider>
        <AuthProvider>
          <AutorizacionProvider>
            <App />
          </AutorizacionProvider>
        </AuthProvider>
        </MarcaProvider>
      </ToastProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
