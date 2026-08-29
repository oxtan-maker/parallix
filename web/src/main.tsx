import { createRoot } from 'react-dom/client';
import { Shell } from './shell.js';
import './style.css';

const rootElement = document.getElementById('root');
if (rootElement === null) {
  throw new Error('web shell root element is missing');
}
createRoot(rootElement).render(<Shell />);
