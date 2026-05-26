"use client";

import { useEffect, useState } from "react";
import { doc, getDoc, setDoc, Timestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Settings, DollarSign, Route, Save, Calculator } from "lucide-react";

interface DeliveryPricing {
  baseFee: number;        // R30 default
  baseDistanceKm: number; // 5km included
  perKmRate: number;      // R5 per extra km
  minFee: number;         // R20 minimum
  maxFee: number;         // R100 maximum cap
  updatedAt?: Timestamp;
}

export default function SettingsPage() {
  const [pricing, setPricing] = useState<DeliveryPricing>({
    baseFee: 30,
    baseDistanceKm: 5,
    perKmRate: 5,
    minFee: 20,
    maxFee: 100,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Test calculation
  const [testDistance, setTestDistance] = useState(8);

  useEffect(() => {
    loadPricing();
  }, []);

  const loadPricing = async () => {
    try {
      const docRef = doc(db, "settings", "deliveryPricing");
      const snap = await getDoc(docRef);
      if (snap.exists()) {
        setPricing(snap.data() as DeliveryPricing);
      }
    } catch (e) {
      console.error("Error loading pricing:", e);
    } finally {
      setLoading(false);
    }
  };

  const savePricing = async () => {
    setSaving(true);
    try {
      await setDoc(doc(db, "settings", "deliveryPricing"), {
        ...pricing,
        updatedAt: Timestamp.now(),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      console.error("Error saving pricing:", e);
    } finally {
      setSaving(false);
    }
  };

  // Calculate delivery fee based on distance
  const calculateFee = (distanceKm: number): number => {
    if (distanceKm <= pricing.baseDistanceKm) {
      return pricing.baseFee;
    }
    const extraKm = distanceKm - pricing.baseDistanceKm;
    const fee = pricing.baseFee + (extraKm * pricing.perKmRate);
    return Math.min(Math.max(fee, pricing.minFee), pricing.maxFee);
  };

  // Calculate driver earnings (70% of delivery fee)
  const calculateDriverEarnings = (distanceKm: number): number => {
    const fee = calculateFee(distanceKm);
    return fee * 0.7; // Driver gets 70%
  };

  if (loading) {
    return (
      <div className="p-6">
        <div className="flex items-center justify-center h-64">
          <div className="w-8 h-8 border-2 border-[#FFD230] border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      <div className="flex items-center gap-3">
        <Settings className="w-8 h-8 text-[#FFD230]" />
        <div>
          <h1 className="text-3xl font-bold">Delivery Settings</h1>
          <p className="text-muted-foreground">
            Configure pricing and driver earnings
          </p>
        </div>
      </div>

      {/* Pricing Configuration */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <DollarSign className="w-5 h-5" />
            Delivery Fee Structure
          </CardTitle>
          <CardDescription>
            Set how much customers pay for delivery based on distance
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Base Fee */}
            <div className="space-y-2">
              <Label htmlFor="baseFee">
                Base Fee (Rands)
                <span className="text-xs text-muted-foreground ml-2">
                  Minimum charge for short trips
                </span>
              </Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">R</span>
                <Input
                  id="baseFee"
                  type="number"
                  value={pricing.baseFee}
                  onChange={(e) => setPricing({ ...pricing, baseFee: Number(e.target.value) })}
                  className="pl-7"
                />
              </div>
            </div>

            {/* Base Distance */}
            <div className="space-y-2">
              <Label htmlFor="baseDistance">
                Included Distance (km)
                <span className="text-xs text-muted-foreground ml-2">
                  Distance covered by base fee
                </span>
              </Label>
              <div className="relative">
                <Input
                  id="baseDistance"
                  type="number"
                  value={pricing.baseDistanceKm}
                  onChange={(e) => setPricing({ ...pricing, baseDistanceKm: Number(e.target.value) })}
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">km</span>
              </div>
            </div>

            {/* Per KM Rate */}
            <div className="space-y-2">
              <Label htmlFor="perKmRate">
                Extra per km (Rands)
                <span className="text-xs text-muted-foreground ml-2">
                  Charge for each km beyond included distance
                </span>
              </Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">R</span>
                <Input
                  id="perKmRate"
                  type="number"
                  value={pricing.perKmRate}
                  onChange={(e) => setPricing({ ...pricing, perKmRate: Number(e.target.value) })}
                  className="pl-7"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">/km</span>
              </div>
            </div>

            {/* Min/Max Caps */}
            <div className="space-y-2">
              <Label>Fee Limits</Label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">Min R</span>
                  <Input
                    type="number"
                    value={pricing.minFee}
                    onChange={(e) => setPricing({ ...pricing, minFee: Number(e.target.value) })}
                    className="pl-12"
                  />
                </div>
                <div className="relative flex-1">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">Max R</span>
                  <Input
                    type="number"
                    value={pricing.maxFee}
                    onChange={(e) => setPricing({ ...pricing, maxFee: Number(e.target.value) })}
                    className="pl-12"
                  />
                </div>
              </div>
            </div>
          </div>

          <Button
            onClick={savePricing}
            disabled={saving}
            className="w-full bg-[#FFD230] text-black hover:bg-yellow-400"
          >
            <Save className="w-4 h-4 mr-2" />
            {saving ? "Saving..." : saved ? "Saved!" : "Save Pricing Settings"}
          </Button>
        </CardContent>
      </Card>

      {/* Calculator Preview */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calculator className="w-5 h-5" />
            Fee Calculator Preview
          </CardTitle>
          <CardDescription>
            Test how delivery fees and driver earnings are calculated
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Test Input */}
          <div className="space-y-2">
            <Label htmlFor="testDistance">
              Test Distance
            </Label>
            <div className="relative">
              <Input
                id="testDistance"
                type="number"
                value={testDistance}
                onChange={(e) => setTestDistance(Number(e.target.value))}
                min={1}
                max={50}
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">km</span>
            </div>
          </div>

          {/* Results */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="p-4 bg-zinc-50 rounded-lg">
              <p className="text-sm text-muted-foreground">Customer Pays</p>
              <p className="text-2xl font-bold">
                R{calculateFee(testDistance).toFixed(2)}
              </p>
              <p className="text-xs text-muted-foreground">
                {testDistance <= pricing.baseDistanceKm
                  ? "Within base distance"
                  : `R${pricing.baseFee} + ${(testDistance - pricing.baseDistanceKm).toFixed(1)}km × R${pricing.perKmRate}`}
              </p>
            </div>

            <div className="p-4 bg-green-50 rounded-lg border border-green-200">
              <p className="text-sm text-green-600">Driver Earnings (70%)</p>
              <p className="text-2xl font-bold text-green-700">
                R{calculateDriverEarnings(testDistance).toFixed(2)}
              </p>
              <p className="text-xs text-green-600">
                70% of delivery fee
              </p>
            </div>

            <div className="p-4 bg-yellow-50 rounded-lg border border-yellow-200">
              <p className="text-sm text-yellow-700">Platform Fee (30%)</p>
              <p className="text-2xl font-bold text-yellow-800">
                R{(calculateFee(testDistance) * 0.3).toFixed(2)}
              </p>
              <p className="text-xs text-yellow-700">
                Tolta commission
              </p>
            </div>
          </div>

          {/* Distance Breakdown */}
          <div className="space-y-2">
            <p className="text-sm font-medium">Common Distance Examples</p>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
              {[2, 5, 8, 12, 20].map((km) => (
                <div
                  key={km}
                  className="p-3 bg-zinc-50 rounded text-center cursor-pointer hover:bg-zinc-100"
                  onClick={() => setTestDistance(km)}
                >
                  <p className="font-medium">{km} km</p>
                  <p className="text-sm text-muted-foreground">
                    R{calculateDriverEarnings(km).toFixed(0)}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Current Settings Summary */}
      <Card className="bg-zinc-50">
        <CardContent className="py-4">
          <p className="text-sm text-muted-foreground">
            <strong>Current formula:</strong> R{pricing.baseFee} base for first {pricing.baseDistanceKm}km, 
            then R{pricing.perKmRate} per extra km. Driver gets 70%, Tolta gets 30%. 
            Fees capped between R{pricing.minFee} - R{pricing.maxFee}.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
