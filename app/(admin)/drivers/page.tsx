"use client";

import { useEffect, useState } from "react";
import {
  collection,
  query,
  where,
  onSnapshot,
  doc,
  updateDoc,
  Timestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Car, CheckCircle, XCircle, Clock, User, Phone, Mail, FileText } from "lucide-react";

interface Driver {
  id: string;
  driverId: string;
  status: "pending_review" | "approved" | "rejected" | "active" | "suspended";
  profile: {
    name: string;
    phone: string;
    email?: string;
    idNumber: string;
    licenseNumber: string;
    vehicleType: string;
    vehicleReg: string;
  };
  createdAt: Timestamp;
  approvedAt?: Timestamp;
  rejectionReason?: string;
  isOnline?: boolean;
}

export default function DriversPage() {
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [selectedDriver, setSelectedDriver] = useState<Driver | null>(null);
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [activeTab, setActiveTab] = useState("pending");

  useEffect(() => {
    const q = query(collection(db, "drivers"));
    
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const driverData: Driver[] = [];
      snapshot.forEach((doc) => {
        driverData.push({ id: doc.id, ...doc.data() } as Driver);
      });
      setDrivers(driverData.sort((a, b) => {
        // Sort by createdAt desc
        return b.createdAt?.seconds - a.createdAt?.seconds;
      }));
    });

    return () => unsubscribe();
  }, []);

  const pendingDrivers = drivers.filter(
    (d) => d.status === "pending_review" || d.status === "rejected"
  );
  const approvedDrivers = drivers.filter(
    (d) => d.status === "approved" || d.status === "active"
  );

  const handleApprove = async (driverId: string) => {
    try {
      await updateDoc(doc(db, "drivers", driverId), {
        status: "approved",
        approvedAt: Timestamp.now(),
        rejectionReason: null,
      });
      setSelectedDriver(null);
    } catch (error) {
      console.error("Error approving driver:", error);
    }
  };

  const handleReject = async (driverId: string) => {
    if (!rejectReason.trim()) return;
    
    try {
      await updateDoc(doc(db, "drivers", driverId), {
        status: "rejected",
        rejectionReason: rejectReason,
        rejectedAt: Timestamp.now(),
      });
      setRejectDialogOpen(false);
      setRejectReason("");
      setSelectedDriver(null);
    } catch (error) {
      console.error("Error rejecting driver:", error);
    }
  };

  const handleSuspend = async (driverId: string) => {
    try {
      await updateDoc(doc(db, "drivers", driverId), {
        status: "suspended",
        suspendedAt: Timestamp.now(),
      });
      setSelectedDriver(null);
    } catch (error) {
      console.error("Error suspending driver:", error);
    }
  };

  const getStatusBadge = (status: string) => {
    const variants: Record<string, { color: string; icon: React.ReactNode }> = {
      pending_review: { color: "bg-yellow-500", icon: <Clock className="w-3 h-3" /> },
      approved: { color: "bg-green-500", icon: <CheckCircle className="w-3 h-3" /> },
      active: { color: "bg-blue-500", icon: <Car className="w-3 h-3" /> },
      rejected: { color: "bg-red-500", icon: <XCircle className="w-3 h-3" /> },
      suspended: { color: "bg-gray-500", icon: <XCircle className="w-3 h-3" /> },
    };

    const variant = variants[status] || variants.pending_review;

    return (
      <Badge className={`${variant.color} text-white flex items-center gap-1`}>
        {variant.icon}
        {status.replace("_", " ").toUpperCase()}
      </Badge>
    );
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Driver Management</h1>
          <p className="text-muted-foreground">
            Review and manage driver applications
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-yellow-600">
            {pendingDrivers.length} Pending
          </Badge>
          <Badge variant="outline" className="text-green-600">
            {approvedDrivers.length} Approved
          </Badge>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="pending">
            Pending Review
            {pendingDrivers.length > 0 && (
              <span className="ml-2 text-xs bg-yellow-500 text-white px-2 py-0.5 rounded-full">
                {pendingDrivers.length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="approved">Approved Drivers</TabsTrigger>
        </TabsList>

        <TabsContent value="pending" className="mt-6">
          <div className="grid gap-4">
            {pendingDrivers.length === 0 ? (
              <Card>
                <CardContent className="p-8 text-center text-muted-foreground">
                  <Clock className="w-12 h-12 mx-auto mb-4 opacity-50" />
                  <p>No pending applications</p>
                </CardContent>
              </Card>
            ) : (
              pendingDrivers.map((driver) => (
                <Card
                  key={driver.id}
                  className="cursor-pointer hover:shadow-md transition-shadow"
                  onClick={() => setSelectedDriver(driver)}
                >
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center">
                          <User className="w-6 h-6 text-primary" />
                        </div>
                        <div>
                          <h3 className="font-semibold">{driver.profile.name}</h3>
                          <p className="text-sm text-muted-foreground">
                            {driver.profile.vehicleType} • {driver.profile.vehicleReg}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Applied {new Date(driver.createdAt?.seconds * 1000).toLocaleDateString()}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {getStatusBadge(driver.status)}
                        <Button size="sm" variant="outline">
                          Review
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </TabsContent>

        <TabsContent value="approved" className="mt-6">
          <div className="grid gap-4">
            {approvedDrivers.length === 0 ? (
              <Card>
                <CardContent className="p-8 text-center text-muted-foreground">
                  <Car className="w-12 h-12 mx-auto mb-4 opacity-50" />
                  <p>No approved drivers yet</p>
                </CardContent>
              </Card>
            ) : (
              approvedDrivers.map((driver) => (
                <Card
                  key={driver.id}
                  className="cursor-pointer hover:shadow-md transition-shadow"
                  onClick={() => setSelectedDriver(driver)}
                >
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center">
                          <Car className="w-6 h-6 text-green-600" />
                        </div>
                        <div>
                          <h3 className="font-semibold">{driver.profile.name}</h3>
                          <p className="text-sm text-muted-foreground">
                            {driver.profile.vehicleType} • {driver.profile.vehicleReg}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {driver.isOnline ? (
                              <span className="text-green-600 flex items-center gap-1">
                                <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                                Online now
                              </span>
                            ) : (
                              "Offline"
                            )}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {getStatusBadge(driver.status)}
                        <Button size="sm" variant="outline">
                          View
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </TabsContent>
      </Tabs>

      {/* Driver Details Dialog */}
      <Dialog open={!!selectedDriver} onOpenChange={() => setSelectedDriver(null)}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          {selectedDriver && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  {getStatusBadge(selectedDriver.status)}
                  <span>{selectedDriver.profile.name}</span>
                </DialogTitle>
                <DialogDescription>
                  Driver ID: {selectedDriver.id.substring(0, 8)}...
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4 py-4">
                {/* Personal Info */}
                <div className="space-y-3">
                  <h4 className="font-semibold text-sm text-muted-foreground uppercase">
                    Personal Information
                  </h4>
                  <div className="grid gap-2 text-sm">
                    <div className="flex items-center gap-2">
                      <User className="w-4 h-4 text-muted-foreground" />
                      <span>{selectedDriver.profile.name}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Phone className="w-4 h-4 text-muted-foreground" />
                      <span>{selectedDriver.profile.phone}</span>
                    </div>
                    {selectedDriver.profile.email && (
                      <div className="flex items-center gap-2">
                        <Mail className="w-4 h-4 text-muted-foreground" />
                        <span>{selectedDriver.profile.email}</span>
                      </div>
                    )}
                    <div className="flex items-center gap-2">
                      <FileText className="w-4 h-4 text-muted-foreground" />
                      <span>ID: {selectedDriver.profile.idNumber}</span>
                    </div>
                  </div>
                </div>

                {/* Vehicle Info */}
                <div className="space-y-3">
                  <h4 className="font-semibold text-sm text-muted-foreground uppercase">
                    Vehicle Information
                  </h4>
                  <div className="grid gap-2 text-sm">
                    <div className="flex items-center gap-2">
                      <Car className="w-4 h-4 text-muted-foreground" />
                      <span>{selectedDriver.profile.vehicleType}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <FileText className="w-4 h-4 text-muted-foreground" />
                      <span>Reg: {selectedDriver.profile.vehicleReg}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <FileText className="w-4 h-4 text-muted-foreground" />
                      <span>License: {selectedDriver.profile.licenseNumber}</span>
                    </div>
                  </div>
                </div>

                {/* Rejection Reason */}
                {selectedDriver.rejectionReason && (
                  <div className="p-3 bg-red-50 border border-red-200 rounded-md">
                    <h4 className="font-semibold text-sm text-red-600 mb-1">
                      Rejection Reason
                    </h4>
                    <p className="text-sm text-red-700">
                      {selectedDriver.rejectionReason}
                    </p>
                  </div>
                )}

                {/* Timeline */}
                <div className="space-y-2 text-xs text-muted-foreground">
                  <p>
                    Applied: {" "}
                    {new Date(selectedDriver.createdAt?.seconds * 1000).toLocaleString()}
                  </p>
                  {selectedDriver.approvedAt && (
                    <p>
                      Approved: {" "}
                      {new Date(selectedDriver.approvedAt?.seconds * 1000).toLocaleString()}
                    </p>
                  )}
                </div>
              </div>

              <DialogFooter className="flex gap-2">
                {selectedDriver.status === "pending_review" && (
                  <>
                    <Button
                      variant="outline"
                      onClick={() => setRejectDialogOpen(true)}
                      className="border-red-500 text-red-600 hover:bg-red-50"
                    >
                      <XCircle className="w-4 h-4 mr-2" />
                      Reject
                    </Button>
                    <Button
                      onClick={() => handleApprove(selectedDriver.id)}
                      className="bg-green-600 hover:bg-green-700"
                    >
                      <CheckCircle className="w-4 h-4 mr-2" />
                      Approve
                    </Button>
                  </>
                )}
                {selectedDriver.status === "rejected" && (
                  <Button
                    onClick={() => handleApprove(selectedDriver.id)}
                    className="bg-green-600 hover:bg-green-700"
                  >
                    <CheckCircle className="w-4 h-4 mr-2" />
                    Approve (Override)
                  </Button>
                )}
                {(selectedDriver.status === "approved" ||
                  selectedDriver.status === "active") && (
                  <Button
                    variant="outline"
                    onClick={() => handleSuspend(selectedDriver.id)}
                    className="border-red-500 text-red-600 hover:bg-red-50"
                  >
                    <XCircle className="w-4 h-4 mr-2" />
                    Suspend Driver
                  </Button>
                )}
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Reject Dialog */}
      <Dialog open={rejectDialogOpen} onOpenChange={setRejectDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject Application</DialogTitle>
            <DialogDescription>
              Please provide a reason for rejection. This will be shown to the driver.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Label htmlFor="reason">Rejection Reason</Label>
            <Input
              id="reason"
              placeholder="e.g., License expired, Incomplete documents..."
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => selectedDriver && handleReject(selectedDriver.id)}
              disabled={!rejectReason.trim()}
            >
              Reject Application
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
