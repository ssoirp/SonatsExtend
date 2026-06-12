'use client';
import { useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { exchangeCode } from '@/lib/spotify';

function CallbackHandler() {
  const router = useRouter();
  const params = useSearchParams();

  useEffect(() => {
    const code = params.get('code');
    if (!code) { router.push('/'); return; }
    exchangeCode(code)
      .then(() => router.push('/'))
      .catch(() => router.push('/'));
  }, [params, router]);

  return (
    <main style={{
      minHeight: '100vh',
      background: 'var(--bg)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    }}>
      <p style={{ color: 'var(--text2)', fontSize: 14 }}>Connectant amb Spotify...</p>
    </main>
  );
}

export default function Callback() {
  return (
    <Suspense>
      <CallbackHandler />
    </Suspense>
  );
}
