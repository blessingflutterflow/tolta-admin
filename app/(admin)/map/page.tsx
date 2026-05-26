"use client";

import { useEffect, useState, useRef } from "react";
import {
  collection,
  query,
  onSnapshot,
  where,
  Timestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Car, Store, Navigation, Users } from "lucide-react";
import VendorPanel from "./VendorPanel";
import DriverPanel from "./DriverPanel";

interface DriverLocation {
  id: string;
  driverId: string;
  driverName: string;
  lat: number;
  lng: number;
  bearing?: number;
  speed?: number;
  isActive: boolean;
  timestamp: Timestamp;
}

interface Vendor {
  id: string;
  storeName: string;
  storeType: string;
  location: { latitude: number; longitude: number };
  address: string;
  isOpen: boolean;
  status: string;
}

// Global promise to track script loading
let googleMapsLoadPromise: Promise<void> | null = null;

// Grayscale map styles (black & white)
const grayscaleMapStyles = [
  {
    featureType: "all",
    elementType: "all",
    stylers: [{ saturation: -100 }],
  },
  {
    featureType: "road",
    elementType: "geometry",
    stylers: [{ lightness: 20 }],
  },
  {
    featureType: "water",
    elementType: "geometry",
    stylers: [{ lightness: -10 }],
  },
  {
    featureType: "poi",
    elementType: "geometry",
    stylers: [{ lightness: 10 }],
  },
];

// Google Maps script loader
const loadGoogleMapsScript = (apiKey: string): Promise<void> => {
  // If already loaded, resolve immediately
  if (window.google?.maps) {
    return Promise.resolve();
  }

  // If currently loading, return existing promise
  if (googleMapsLoadPromise) {
    return googleMapsLoadPromise;
  }

  // Check if script tag already exists
  const existingScript = document.querySelector(`script[src*="maps.googleapis.com"]`);
  if (existingScript) {
    return new Promise((resolve) => {
      const checkLoaded = setInterval(() => {
        if (window.google?.maps) {
          clearInterval(checkLoaded);
          resolve();
        }
      }, 100);
    });
  }

  // Create new load promise
  googleMapsLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=marker`;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load Google Maps"));
    document.head.appendChild(script);
  });

  return googleMapsLoadPromise;
};

export default function OperationsMapPage() {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<google.maps.Map | null>(null);
  const driverMarkersRef = useRef<Map<string, google.maps.Marker>>(new Map());
  const vendorMarkersRef = useRef<Map<string, google.maps.Marker>>(new Map());

  const [drivers, setDrivers] = useState<DriverLocation[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [onlineCount, setOnlineCount] = useState(0);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [error, setError] = useState("");
  const [selectedVendor, setSelectedVendor] = useState<Vendor | null>(null);
  const [selectedDriver, setSelectedDriver] = useState<DriverLocation | null>(null);

  // Stable callback refs — click handlers inside marker closures always call latest setter
  const onVendorClickRef = useRef<(v: Vendor) => void>(() => {});
  const onDriverClickRef = useRef<(d: DriverLocation) => void>(() => {});
  onVendorClickRef.current = (v) => { setSelectedDriver(null); setSelectedVendor(v); };
  onDriverClickRef.current = (d) => { setSelectedVendor(null); setSelectedDriver(d); };

  const GOOGLE_MAPS_API_KEY = "AIzaSyACvTcggQR4fzsfRFtzIKyhfQVQVGKRiMo";

  // Initialize map
  useEffect(() => {
    loadGoogleMapsScript(GOOGLE_MAPS_API_KEY)
      .then(() => {
        if (mapRef.current && !mapInstanceRef.current) {
          const map = new google.maps.Map(mapRef.current, {
            center: { lat: -26.2041, lng: 28.0473 }, // Johannesburg
            zoom: 12,
            mapTypeId: "roadmap",
            styles: grayscaleMapStyles,
            mapTypeControl: false,
            fullscreenControl: false,
            streetViewControl: false,
            zoomControl: true,
            zoomControlOptions: {
              position: google.maps.ControlPosition.RIGHT_BOTTOM,
            },
          });
          mapInstanceRef.current = map;
          setMapLoaded(true);
        }
      })
      .catch((err) => {
        console.error("Failed to load Google Maps:", err);
        setError("Failed to load Google Maps. Check API key.");
      });

    return () => {
      // Cleanup markers
      driverMarkersRef.current.forEach((marker) => marker.setMap(null));
      vendorMarkersRef.current.forEach((marker) => marker.setMap(null));
    };
  }, []);

  // Subscribe to driver locations — state only
  useEffect(() => {
    const q = query(
      collection(db, "tracking_sessions"),
      where("isActive", "==", true)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const driverData: DriverLocation[] = [];
      snapshot.forEach((doc) => {
        const data = doc.data();
        driverData.push({
          id: doc.id,
          driverId: data.driverId,
          driverName: data.driverName || "Driver",
          lat: data.lat,
          lng: data.lng,
          bearing: data.bearing,
          speed: data.speed,
          isActive: data.isActive,
          timestamp: data.timestamp,
        });
      });
      setDrivers(driverData);
      setOnlineCount(driverData.length);
    });

    return () => unsubscribe();
  }, []);

  // Subscribe to vendors — state only
  useEffect(() => {
    const q = query(
      collection(db, "vendors"),
      where("status", "==", "active")
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const vendorData: Vendor[] = [];
      snapshot.forEach((doc) => {
        const data = doc.data();
        if (data.location) {
          vendorData.push({
            id: doc.id,
            storeName: data.storeName || "Store",
            storeType: data.storeType || "Store",
            location: data.location,
            address: data.address || "",
            isOpen: data.isOpen ?? false,
            status: data.status,
          });
        }
      });
      setVendors(vendorData);
    });

    return () => unsubscribe();
  }, []);

  // Draw driver markers whenever map becomes ready OR driver data changes
  useEffect(() => {
    if (!mapLoaded) return;
    updateDriverMarkers(drivers);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapLoaded, drivers]);

  // Draw vendor markers whenever map becomes ready OR vendor data changes
  useEffect(() => {
    if (!mapLoaded) return;
    updateVendorMarkers(vendors);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapLoaded, vendors]);

  // Update driver markers on map
  const updateDriverMarkers = (driverLocations: DriverLocation[]) => {
    if (!mapInstanceRef.current) return;
    const map = mapInstanceRef.current;
    const existingMarkers = driverMarkersRef.current;

    existingMarkers.forEach((marker, id) => {
      if (!driverLocations.find((d) => d.id === id)) {
        marker.setMap(null);
        existingMarkers.delete(id);
      }
    });

    driverLocations.forEach((driver) => {
      const position = { lat: driver.lat, lng: driver.lng };
      if (existingMarkers.has(driver.id)) {
        existingMarkers.get(driver.id)!.setPosition(position);
      } else {
        const marker = new google.maps.Marker({
          position, map,
          title: driver.driverName,
          cursor: "pointer",
          icon: {
            url: `data:image/svg+xml,${encodeURIComponent(createDriverSvg())}`,
            scaledSize: new google.maps.Size(44, 44),
            anchor: new google.maps.Point(22, 22),
          },
        });
        marker.addListener("click", () => onDriverClickRef.current(driver));
        existingMarkers.set(driver.id, marker);
      }
    });
  };

  // Update vendor markers on map
  const updateVendorMarkers = (vendorList: Vendor[]) => {
    if (!mapInstanceRef.current) return;
    const map = mapInstanceRef.current;
    const existingMarkers = vendorMarkersRef.current;

    existingMarkers.forEach((marker, id) => {
      if (!vendorList.find((v) => v.id === id)) {
        marker.setMap(null);
        existingMarkers.delete(id);
      }
    });

    vendorList.forEach((vendor) => {
      const position = {
        lat: vendor.location.latitude,
        lng: vendor.location.longitude,
      };
      if (existingMarkers.has(vendor.id)) {
        existingMarkers.get(vendor.id)!.setPosition(position);
      } else {
        const marker = new google.maps.Marker({
          position, map,
          title: vendor.storeName,
          cursor: "pointer",
          icon: {
            url: `data:image/svg+xml,${encodeURIComponent(createVendorSvg(vendor.isOpen))}`,
            scaledSize: new google.maps.Size(42, 42),
            anchor: new google.maps.Point(21, 21),
          },
        });
        marker.addListener("click", () => onVendorClickRef.current(vendor));
        existingMarkers.set(vendor.id, marker);
      }
    });
  };

  // Driver marker — yellow circle with car silhouette
  const createDriverSvg = () => `<svg xmlns="http://www.w3.org/2000/svg" width="44" height="44" viewBox="0 0 44 44">
    <circle cx="22" cy="22" r="20" fill="#FFD230" stroke="#111" stroke-width="2.5"/>
    <!-- car body -->
    <rect x="9" y="24" width="26" height="8" rx="2" fill="#111"/>
    <!-- car cabin -->
    <path d="M13 24 L16 17 L28 17 L31 24 Z" fill="#111"/>
    <!-- windscreen -->
    <path d="M17 24 L19 19 L25 19 L27 24 Z" fill="#FFD230"/>
    <!-- rear window -->
    <path d="M14.5 24 L16.5 20 L18 24 Z" fill="#FFD230" opacity="0.5"/>
    <!-- wheels -->
    <circle cx="14" cy="32" r="3.5" fill="#222" stroke="#FFD230" stroke-width="1.5"/>
    <circle cx="30" cy="32" r="3.5" fill="#222" stroke="#FFD230" stroke-width="1.5"/>
    <!-- headlight -->
    <rect x="31" y="26" width="3" height="2" rx="1" fill="#fff" opacity="0.9"/>
    <!-- tail light -->
    <rect x="10" y="26" width="3" height="2" rx="1" fill="#f00" opacity="0.7"/>
  </svg>`;

  // Vendor marker — black pin with store icon
  const createVendorSvg = (isOpen: boolean) => {
    const ringColor = isOpen ? "#22c55e" : "#ef4444";
    return `<svg xmlns="http://www.w3.org/2000/svg" width="42" height="42" viewBox="0 0 42 42">
      <circle cx="21" cy="21" r="19" fill="#111" stroke="${ringColor}" stroke-width="3"/>
      <!-- awning triangle -->
      <path d="M10 19 L21 11 L32 19 Z" fill="#FFD230"/>
      <!-- building body -->
      <rect x="12" y="19" width="18" height="13" fill="#fff" rx="1"/>
      <!-- door -->
      <rect x="17" y="24" width="8" height="8" rx="1" fill="#111"/>
      <!-- left window -->
      <rect x="13" y="21" width="4" height="3" rx="0.5" fill="#FFD230"/>
      <!-- right window -->
      <rect x="25" y="21" width="4" height="3" rx="0.5" fill="#FFD230"/>
      <!-- open/closed dot -->
      <circle cx="21" cy="10" r="3" fill="${ringColor}"/>
    </svg>`;
  };

  return (
    <div className="h-[calc(100vh-64px)] flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-zinc-200 bg-white">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Live Operations Map</h1>
            <p className="text-sm text-muted-foreground">
              Real-time driver locations and active vendors
            </p>
          </div>
          <div className="flex gap-2">
            <Badge variant="outline" className="bg-yellow-100 text-yellow-700 border-yellow-300">
              <Car className="w-3 h-3 mr-1" />
              {onlineCount} Online Drivers
            </Badge>
            <Badge variant="outline" className="bg-green-100 text-green-700 border-green-300">
              <Store className="w-3 h-3 mr-1" />
              {vendors.filter((v) => v.isOpen).length} Open Vendors
            </Badge>
          </div>
        </div>
      </div>

      {/* Map Container */}
      <div className="flex-1 relative">
        {error ? (
          <div className="h-full flex items-center justify-center">
            <Card>
              <CardContent className="p-8 text-center">
                <Navigation className="w-12 h-12 mx-auto mb-4 text-red-500" />
                <p className="text-red-500">{error}</p>
              </CardContent>
            </Card>
          </div>
        ) : (
          <>
            <div ref={mapRef} className="w-full h-full" />

            {/* Legend */}
            <div className="absolute bottom-4 left-4 bg-white rounded-lg shadow-lg p-3">
              <h4 className="text-xs font-semibold text-muted-foreground uppercase mb-2">
                Legend
              </h4>
              <div className="space-y-2 text-sm">
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full bg-yellow-400 border border-black"></span>
                  <span>Online Driver</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded bg-green-500"></span>
                  <span>Open Vendor</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded bg-red-500"></span>
                  <span>Closed Vendor</span>
                </div>
              </div>
            </div>

            {/* Drivers list — hidden when a panel is open */}
            {!selectedVendor && !selectedDriver && (
              <div className="absolute top-4 right-4 w-64 max-h-[calc(100%-2rem)] overflow-auto">
                <Card>
                  <CardHeader className="py-3">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Users className="w-4 h-4" />
                      Online Drivers ({drivers.length})
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="py-0">
                    <div className="space-y-2">
                      {drivers.length === 0 ? (
                        <p className="text-sm text-muted-foreground py-4 text-center">
                          No drivers online
                        </p>
                      ) : (
                        drivers.map((driver) => (
                          <div
                            key={driver.id}
                            className="flex items-center gap-2 p-2 rounded hover:bg-zinc-50 cursor-pointer"
                            onClick={() => {
                              if (mapInstanceRef.current) {
                                mapInstanceRef.current.panTo({ lat: driver.lat, lng: driver.lng });
                                mapInstanceRef.current.setZoom(16);
                              }
                              onDriverClickRef.current(driver);
                            }}
                          >
                            <Car className="w-4 h-4 text-yellow-500" />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium truncate">{driver.driverName}</p>
                              <p className="text-xs text-muted-foreground">
                                {(driver.speed || 0).toFixed(0)} km/h
                              </p>
                            </div>
                            <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                          </div>
                        ))
                      )}
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}

            {/* Vendor detail panel */}
            {selectedVendor && (
              <VendorPanel
                vendor={selectedVendor}
                onClose={() => setSelectedVendor(null)}
              />
            )}

            {/* Driver detail panel */}
            {selectedDriver && (
              <DriverPanel
                driver={selectedDriver}
                onClose={() => setSelectedDriver(null)}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}

// Extend Window interface for Google Maps
declare global {
  interface Window {
    google?: typeof google;
  }
}
