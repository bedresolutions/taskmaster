import { useState } from 'react';
import { sendPasswordResetEmail } from 'firebase/auth';
import { auth } from './firebase';
import { Link } from 'react-router-dom';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'sent' | 'error'>('idle');
  const [error, setError] = useState('');

const handleSubmit = async (e?: React.MouseEvent) => {
  e?.preventDefault(); // ✅ ADD THIS

  try {
    await sendPasswordResetEmail(auth, email);
    setStatus('sent');
  } catch (e: any) {
    setError(e.message);
    setStatus('error');
  }
};

  return (
    <div className="h-screen flex items-center justify-center bg-gradient-to-br from-blue-500 to-purple-500">
      <div className="bg-white p-8 rounded-2xl shadow-xl w-96">
        <h2 className="text-2xl font-bold mb-6 text-center">Forgot Password?</h2>
        {status === 'sent' ? (
          <p className="text-center">Check your inbox for a reset link.</p>
        ) : (
          <>
            <input
              type="email"
              placeholder="Email"
              className="w-full p-3 mb-4 border rounded-lg"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <button type="button" onClick={handleSubmit}
              className="w-full bg-blue-600 text-white p-3 rounded-lg hover:bg-blue-700"
            >
              Send Reset Email
            </button>
            {status === 'error' && <p className="text-red-600 mt-2">{error}</p>}
          </>
        )}
        <p className="text-center text-sm text-neutral-500 mt-4">
          Remembered?{' '}
          <Link to="/login" className="text-blue-600 hover:underline">
            Login
          </Link>
        </p>
      </div>
    </div>
  );
}