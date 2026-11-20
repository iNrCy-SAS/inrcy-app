"use client";

import { useEffect, useRef } from "react";
import "@/ops/wordpress-visio-booking/inrcy-visio-booking.js";
import "@/ops/wordpress-visio-booking/inrcy-visio-booking.css";

type BookingElement = HTMLElement & { open(token: string, onContinue: () => void): void };

export default function PaidSignupBooking({ token, onContinue }: { token: string; onContinue: () => void }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!host.current) return;
    const booking = document.createElement("inrcy-paid-booking") as BookingElement;
    host.current.append(booking);
    booking.open(token, onContinue);
    return () => booking.remove();
  }, [token, onContinue]);
  return <div ref={host} />;
}
