"use client";

import { useEffect, useState } from "react";
import { doc, onSnapshot, setDoc, serverTimestamp, Timestamp } from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";
import firebaseApp, { db, auth } from "@/lib/firebase";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Settings, DollarSign, Route, Save, Calculator, RefreshCw, AlertTriangle, CheckCircle2 } from "lucide-react";

// Mirrors BusinessSettings in functions/src/index.ts — single source of truth.
interface BusinessSettings {
  markupRate:            number;   // 0.17 = 17% platform markup on merchant price
  driverCommissionRate:  number;   // 0.10 = Tolta keeps 10% of delivery fee
  deliveryFeeBase:       number;   // R base delivery fee
  deliveryFeePerKm:      number;   // R per km
  deliveryRadiusKmMax:   number;   // max km customer ↔ vendor
  driverSearchRadiusKm:  number;   // max km to look for a driver
  minOrderDefault:       number;   // fallback min order
  absorbPaystackFee:     boolean;  // true = Tolta absorbs (Option A)
  updatedAt?:            Timestamp;
  updatedBy?:            string;
}

const DEFAULTS: BusinessSettings = {
  markupRate:            0.17,
  driverCommissionRate:  0.10,
  deliveryFeeBase:       15,
  deliveryFeePerKm:      3,
  deliveryRadiusKmMax:   15,
  driverSearchRadiusKm:  20,
  minOrderDefault:       50,
  absorbPaystackFee:     true,
};

const functions = getFunctions(firebaseApp, "us-central1");
const recalculatePrices = httpsCallable<Record<string, never>, { updated: number; skipped: number; markupRate: number }>(
  functions,
  "recalculateAllProductPrices",
);

export default function SettingsPage() {
  const [settings, setSettings] = useState<BusinessSettings>(DEFAULTS);
  const [initialLoad, setInitialLoad] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [recalculating, setRecalculating] = useState(false);
  const [markupChanged, setMarkupChanged] = useState(false);
  const [initialMarkup, setInitialMarkup] = useState<number | null>(null);

  // Live listener — any admin's change reflects instantly, no reload needed.
  useEffect(() => {
    const unsub = onSnapshot(doc(db, "settings", "business"), (snap) => {
      if (snap.exists()) {
        const data = { ...DEFAULTS, ...(snap.data() as Partial<BusinessSettings>) };
        setSettings(data);
        if (initialMarkup === null) setInitialMarkup(data.markupRate);
      }
      setInitialLoad(false);
    });
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Detect whether markup has been changed since load — used to nudge admin
  // to recalculate existing product prices.
  useEffect(() => {
    if (initialMarkup !== null) {
      setMarkupChanged(settings.markupRate !== initialMarkup);
    }
  }, [settings.markupRate, initialMarkup]);

  const save = async () => {
    setSaving(true);
    try {
      await setDoc(
        doc(db, "settings", "business"),
        {
          ...settings,
          updatedAt: serverTimestamp(),
          updatedBy: auth.currentUser?.email ?? auth.currentUser?.uid ?? "unknown",
        },
        { merge: true },
      );
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      alert("Save failed: " + (e as { message?: string }).message);
    } finally {
      setSaving(false);
    }
  };

  const recalculate = async () => {
    if (!confirm(
      `Update every existing product to use the new ${(settings.markupRate * 100).toFixed(1)}% markup?\n\n` +
      `New displayed price = merchant price × ${(1 + settings.markupRate).toFixed(4)}`,
    )) return;
    setRecalculating(true);
    try {
      const res = await recalculatePrices({});
      alert(`✅ Recalculated ${res.data.updated} products (skipped ${res.data.skipped}).`);
      setInitialMarkup(settings.markupRate);
    } catch (e) {
      alert("Recalculation failed: " + (e as { message?: string }).message);
    } finally {
      setRecalculating(false);
    }
  };

  // ── Preview math on a sample R100 merchant product ────────────────────────
  const previewMerchantPrice = 100;
  const previewDeliveryDistanceKm = 8;
  const displayedPrice = previewMerchantPrice * (1 + settings.markupRate);
  const previewDeliveryFee = settings.deliveryFeeBase + previewDeliveryDistanceKm * settings.deliveryFeePerKm;
  const previewTotal = displayedPrice + previewDeliveryFee;
  const markup = displayedPrice - previewMerchantPrice;
  const driverPayout = previewDeliveryFee * (1 - settings.driverCommissionRate);
  const driverCut = previewDeliveryFee - driverPayout;
  const paystackFee = previewTotal * 0.029 + 1;
  const toltaGross = markup + driverCut;
  const toltaNet = settings.absorbPaystackFee ? toltaGross - paystackFee : toltaGross;

  if (initialLoad) {
    return (
      <div className="p-6 flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-[#FFD230] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      <div className="flex items-center gap-3">
        <Settings className="w-8 h-8 text-[#FFD230]" />
        <div>
          <h1 className="text-3xl font-bold">Business Settings</h1>
          <p className="text-muted-foreground text-sm">
            Every rule below affects the apps in real time. Vendors, consumers, and drivers see the impact within 60 seconds.
          </p>
        </div>
      </div>

      {settings.updatedAt && (
        <div className="text-xs text-muted-foreground">
          Last updated {settings.updatedAt.toDate().toLocaleString("en-ZA")}
          {settings.updatedBy ? ` by ${settings.updatedBy}` : ""}
        </div>
      )}

      {/* ── Commission & markup ─────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <DollarSign className="w-5 h-5" />
            Commission & Markup
          </CardTitle>
          <CardDescription>
            The platform markup is added on top of every merchant&apos;s price. Merchants get what they set; the markup funds Tolta.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-2">
            <Label>Platform markup on merchant price</Label>
            <div className="relative">
              <Input
                type="number"
                step="0.01"
                min="0"
                max="1"
                value={settings.markupRate}
                onChange={(e) => setSettings({ ...settings, markupRate: Number(e.target.value) })}
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                = {(settings.markupRate * 100).toFixed(1)}%
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              Merchant sets R100 → customer sees R{(100 * (1 + settings.markupRate)).toFixed(2)}.
            </p>
          </div>

          <div className="space-y-2">
            <Label>Tolta&apos;s cut of driver&apos;s delivery fee</Label>
            <div className="relative">
              <Input
                type="number"
                step="0.01"
                min="0"
                max="1"
                value={settings.driverCommissionRate}
                onChange={(e) => setSettings({ ...settings, driverCommissionRate: Number(e.target.value) })}
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                = {(settings.driverCommissionRate * 100).toFixed(1)}%
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              R30 delivery → driver gets R{(30 * (1 - settings.driverCommissionRate)).toFixed(2)}, Tolta keeps R{(30 * settings.driverCommissionRate).toFixed(2)}.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* ── Delivery pricing ────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Route className="w-5 h-5" />
            Delivery Pricing
          </CardTitle>
          <CardDescription>
            Delivery fee = base + (distance × per-km rate). Computed server-side; clients can&apos;t override.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-2">
            <Label>Base fee</Label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">R</span>
              <Input
                type="number"
                step="0.5"
                min="0"
                value={settings.deliveryFeeBase}
                onChange={(e) => setSettings({ ...settings, deliveryFeeBase: Number(e.target.value) })}
                className="pl-7"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Per-km rate</Label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">R</span>
              <Input
                type="number"
                step="0.5"
                min="0"
                value={settings.deliveryFeePerKm}
                onChange={(e) => setSettings({ ...settings, deliveryFeePerKm: Number(e.target.value) })}
                className="pl-7"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">/km</span>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Max delivery radius (customer ↔ vendor)</Label>
            <div className="relative">
              <Input
                type="number"
                step="1"
                min="1"
                value={settings.deliveryRadiusKmMax}
                onChange={(e) => setSettings({ ...settings, deliveryRadiusKmMax: Number(e.target.value) })}
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">km</span>
            </div>
            <p className="text-xs text-muted-foreground">
              Vendors further than this from the customer won&apos;t appear in browse.
            </p>
          </div>

          <div className="space-y-2">
            <Label>Driver search radius</Label>
            <div className="relative">
              <Input
                type="number"
                step="1"
                min="1"
                value={settings.driverSearchRadiusKm}
                onChange={(e) => setSettings({ ...settings, driverSearchRadiusKm: Number(e.target.value) })}
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">km</span>
            </div>
            <p className="text-xs text-muted-foreground">
              When assigning an order, only consider drivers within this range.
            </p>
          </div>

          <div className="space-y-2">
            <Label>Default minimum order</Label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">R</span>
              <Input
                type="number"
                step="5"
                min="0"
                value={settings.minOrderDefault}
                onChange={(e) => setSettings({ ...settings, minOrderDefault: Number(e.target.value) })}
                className="pl-7"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Fallback for vendors that haven&apos;t set their own.
            </p>
          </div>

          <div className="space-y-2">
            <Label>Payment processing fee handling</Label>
            <div className="flex items-center gap-3 h-10">
              <input
                type="checkbox"
                id="absorb"
                checked={settings.absorbPaystackFee}
                onChange={(e) => setSettings({ ...settings, absorbPaystackFee: e.target.checked })}
                className="w-4 h-4"
              />
              <label htmlFor="absorb" className="text-sm">
                Tolta absorbs the Paystack fee (Option A)
              </label>
            </div>
            <p className="text-xs text-muted-foreground">
              If unchecked, the fee gets added to what the customer pays.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* ── Save + Recalculate ─────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row gap-3">
        <Button
          onClick={save}
          disabled={saving}
          className="flex-1 bg-[#FFD230] text-black hover:bg-yellow-400"
          size="lg"
        >
          <Save className="w-4 h-4 mr-2" />
          {saving ? "Saving…" : saved ? "Saved ✓" : "Save Business Settings"}
        </Button>

        {markupChanged && (
          <Button
            onClick={recalculate}
            disabled={recalculating}
            variant="outline"
            className="flex-1 border-amber-500 text-amber-700 hover:bg-amber-50"
            size="lg"
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${recalculating ? "animate-spin" : ""}`} />
            {recalculating ? "Recalculating…" : "Apply new markup to existing products"}
          </Button>
        )}
      </div>

      {markupChanged && (
        <div className="flex items-start gap-2 text-sm p-3 bg-amber-50 border border-amber-200 rounded-md">
          <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
          <div>
            You changed the markup rate. New products vendors add will use {(settings.markupRate * 100).toFixed(1)}% automatically.
            Existing products keep their current prices unless you click <strong>Apply new markup to existing products</strong>.
          </div>
        </div>
      )}

      {/* ── Preview ─────────────────────────────────────────────────────── */}
      <Card className="bg-zinc-50 border-2">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calculator className="w-5 h-5" />
            Live Preview — Sample Order
          </CardTitle>
          <CardDescription>
            R100 merchant product + {previewDeliveryDistanceKm}km delivery using the settings above.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <PreviewTile
              label="Customer sees"
              value={`R${displayedPrice.toFixed(2)}`}
              sub={`Merchant R${previewMerchantPrice} + ${(settings.markupRate * 100).toFixed(1)}% markup`}
            />
            <PreviewTile
              label="Delivery fee"
              value={`R${previewDeliveryFee.toFixed(2)}`}
              sub={`R${settings.deliveryFeeBase} + ${previewDeliveryDistanceKm}km × R${settings.deliveryFeePerKm}`}
            />
            <PreviewTile
              label="Total customer pays"
              value={`R${previewTotal.toFixed(2)}`}
              sub="Product + delivery"
              highlight
            />
            <PreviewTile
              label="Paystack fee"
              value={`R${paystackFee.toFixed(2)}`}
              sub="2.9% + R1 per transaction"
              tone="fee"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
            <PreviewTile
              label="→ Merchant gets"
              value={`R${previewMerchantPrice.toFixed(2)}`}
              sub="Settled to their bank T+2"
              tone="green"
            />
            <PreviewTile
              label="→ Driver gets"
              value={`R${driverPayout.toFixed(2)}`}
              sub={`${((1 - settings.driverCommissionRate) * 100).toFixed(0)}% of delivery fee`}
              tone="green"
            />
            <PreviewTile
              label="→ Tolta net"
              value={`R${toltaNet.toFixed(2)}`}
              sub={
                settings.absorbPaystackFee
                  ? `Markup R${markup.toFixed(2)} + driver cut R${driverCut.toFixed(2)} − Paystack R${paystackFee.toFixed(2)}`
                  : `Markup R${markup.toFixed(2)} + driver cut R${driverCut.toFixed(2)} (customer pays Paystack fee)`
              }
              tone="tolta"
            />
          </div>

          <div className="flex items-center gap-2 mt-4 text-xs text-muted-foreground">
            <CheckCircle2 className="w-3.5 h-3.5 text-green-600" />
            All three parties sum to R{(previewMerchantPrice + driverPayout + toltaNet + (settings.absorbPaystackFee ? paystackFee : 0)).toFixed(2)} — matches what customer paid.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function PreviewTile({
  label, value, sub, highlight, tone,
}: {
  label: string; value: string; sub: string;
  highlight?: boolean;
  tone?: "green" | "tolta" | "fee";
}) {
  const bg =
    tone === "green" ? "bg-green-50 border-green-200"
    : tone === "tolta" ? "bg-[#FFD230]/10 border-[#FFD230]"
    : tone === "fee" ? "bg-red-50 border-red-200"
    : highlight ? "bg-white border-zinc-300"
    : "bg-white border-zinc-200";
  const valColor =
    tone === "green" ? "text-green-700"
    : tone === "tolta" ? "text-zinc-900"
    : tone === "fee" ? "text-red-700"
    : "text-zinc-900";

  return (
    <div className={`p-3 rounded-lg border ${bg}`}>
      <p className="text-xs text-zinc-500">{label}</p>
      <p className={`text-xl font-bold ${valColor}`}>{value}</p>
      <p className="text-xs text-zinc-500 mt-1">{sub}</p>
    </div>
  );
}
