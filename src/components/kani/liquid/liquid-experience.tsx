import { useState, useCallback, useEffect } from 'react';
import { useLocation, useNavigate } from '@tanstack/react-router';
import { LiquidLanding } from './liquid-landing';
import { LiquidBookingFlow } from './liquid-booking-flow';
import type { Barber, ServiceId } from '@/lib/kani-model';
import './liquid-glass.css';

export function LiquidExperience() {
  const [view, setView] = useState<'landing' | 'booking'>('landing');
  const [selectedService, setSelectedService] = useState<ServiceId | null>(null);
  const [selectedBarber, setSelectedBarber] = useState<Barber | null>(null);

  const startBooking = useCallback((params?: { service?: ServiceId; barber?: Barber }) => {
    if (params?.service) setSelectedService(params.service);
    if (params?.barber) setSelectedBarber(params.barber);
    setView('booking');
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, []);

  const exitBooking = useCallback(() => {
    setView('landing');
    setSelectedService(null);
    setSelectedBarber(null);
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, []);

  return (
    <div className="liquid-experience">
      <div className="site-container max-w-4xl mx-auto px-4 py-4 min-h-[90vh]">
        {view === 'landing' ? (
          <LiquidLanding onStartBooking={startBooking} />
        ) : (
          <LiquidBookingFlow
            initialService={selectedService}
            initialBarber={selectedBarber}
            onExitBooking={exitBooking}
          />
        )}
      </div>
    </div>
  );
}
