import { FormEvent, useState } from 'react';
import { useAuth } from '../auth';
import { Campo } from '../components/ui';
import { urlImagen, useMarca } from '../marca';

export default function Login() {
  const { entrar } = useAuth();
  const { marca } = useMarca();
  const logo = urlImagen('LOGO', marca);
  const [usuario, setUsuario] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    setEnviando(true);
    setError('');
    try {
      await entrar(usuario, password);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="login">
      <form className="card stack" onSubmit={enviar}>
        {logo ? (
          <div className="stack" style={{ alignItems: 'center', gap: 8 }}>
            <img className="login-logo" src={logo} alt={marca.nombre} />
            <div className="muted">Ingresa para continuar</div>
          </div>
        ) : (
          <div className="row" style={{ gap: 12 }}>
            <div className="brand-mark" style={{ width: 40, height: 40, fontSize: 18 }}>C</div>
            <div>
              <h1>Candy's Market</h1>
              <div className="muted">Ingresa para continuar</div>
            </div>
          </div>
        )}
        {error && <div className="alert danger">{error}</div>}
        <Campo label="Usuario">
          <input value={usuario} onChange={(e) => setUsuario(e.target.value)} autoFocus autoComplete="username" />
        </Campo>
        <Campo label="Contraseña">
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
        </Campo>
        <button className="btn btn-primary" disabled={enviando || !usuario || !password}>
          {enviando ? 'Ingresando…' : 'Ingresar'}
        </button>
      </form>
    </div>
  );
}
