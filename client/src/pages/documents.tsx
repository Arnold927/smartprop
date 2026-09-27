import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest, uploadWithAuth, ensureArray } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
 FileText, Upload, Download, Trash2, Eye,
 File, FileImage, FileCode, Plus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatDistanceToNow } from "date-fns";
import { PageShell, PageHeader, SectionCard, SPBadge, EmptyState, PrimaryButton, SecondaryButton, FilterBar, SPTable, SPAvatar, StatTile, StatsGrid, KESAmount, ActionMenu, ConfirmDialog } from "@/components/ui/sp-ui";

interface Document {
 id: number;
 name: string;
 type?: string;
 url: string;
 size?: number;
 createdAt: string;
 tenantId?: number;
 propertyId?: number;
 uploadedBy?: string;
 mimeType?: string;
}

function FileIcon({ mime }: { mime?: string }) {
 if (!mime) return <FileText className="w-5 h-5 text-muted-foreground" />;
 if (mime.startsWith("image/")) return <FileImage className="w-5 h-5 text-blue-400" />;
 if (mime === "application/pdf") return <FileText className="w-5 h-5 text-red-400" />;
 if (mime.includes("sheet") || mime.includes("excel")) return <FileCode className="w-5 h-5 text-green-500" />;
 return <File className="w-5 h-5 text-muted-foreground" />;
}

function fmtSize(bytes?: number) {
 if (!bytes) return "";
 if (bytes < 1024) return `${bytes} B`;
 if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
 return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function Documents() {
 const { toast } = useToast();
 const queryClient = useQueryClient();
 const fileInputRef = useRef<HTMLInputElement>(null);
 const [search, setSearch] = useState("");
 const [typeFilter, setTypeFilter] = useState("all");
 const [isDragging, setIsDragging] = useState(false);

 const { data: docsRaw = [], isLoading } = useQuery<any>({
 queryKey: ["/api/documents"],
 queryFn: async () => { const r = await apiRequest("/api/documents"); return ensureArray(await r.json()); },
 staleTime: 2 * 60 * 1000,
 });
 const documents: Document[] = Array.isArray(docsRaw) ? docsRaw : (docsRaw?.results ?? []);

 const uploadMutation = useMutation({
 mutationFn: async (files: File[]) => {
 const results = [];
 for (const file of files) {
 const fd = new FormData();
 fd.append("file", file);
 fd.append("name", file.name);
 const r = await uploadWithAuth("/api/documents/upload", fd);
 results.push(await r.json());
 }
 return results;
 },
 onSuccess: (results) => {
 queryClient.invalidateQueries({ queryKey: ["/api/documents"] });
 toast({ title: "Upload complete", description: `${results.length} file(s) uploaded` });
 },
 onError: () => toast({ title: "Upload failed", variant: "destructive" }),
 });

 const deleteMutation = useMutation({
 mutationFn: async (id: number) => {
 await apiRequest(`/api/documents/${id}`, { method: "DELETE" });
 },
 onSuccess: () => {
 queryClient.invalidateQueries({ queryKey: ["/api/documents"] });
 toast({ title: "Document deleted" });
 },
 onError: () => toast({ title: "Delete failed", variant: "destructive" }),
 });

 const handleFiles = (files: FileList | null) => {
 if (!files || files.length === 0) return;
 uploadMutation.mutate(Array.from(files));
 };

 const handleDrop = (e: React.DragEvent) => {
 e.preventDefault();
 setIsDragging(false);
 handleFiles(e.dataTransfer.files);
 };

 const filtered = documents.filter(d => {
 const matchSearch = !search || d.name.toLowerCase().includes(search.toLowerCase());
 const matchType = typeFilter === "all" || (typeFilter === "pdf" && d.mimeType === "application/pdf") || (typeFilter === "image" && d.mimeType?.startsWith("image/")) || (typeFilter === "other" && d.mimeType && !d.mimeType.startsWith("image/") && d.mimeType !== "application/pdf");
 return matchSearch && matchType;
 });

 const totalSize = documents.reduce((s, d) => s + (d.size ?? 0), 0);

 return (
 <PageShell>
 <PageHeader
   title="Documents"
   subtitle={`${documents.length} files · ${fmtSize(totalSize)}`}
   icon={<FileText className="w-5 h-5" />}
   actions={
     <>
       <PrimaryButton icon={uploadMutation.isPending ? <Upload className="w-4 h-4 animate-bounce" /> : <Plus className="w-4 h-4" />} onClick={() => fileInputRef.current?.click()} disabled={uploadMutation.isPending}>
         {uploadMutation.isPending ? "Uploading..." : "Upload files"}
       </PrimaryButton>
       <input ref={fileInputRef} type="file" multiple className="hidden" onChange={e => handleFiles(e.target.files)} />
     </>
   }
 />

 {/* Drop zone */}
 <div
 className={`border-2 border-dashed rounded-2xl p-8 text-center transition-colors ${isDragging ? "border-blue-400 bg-blue-50 dark:bg-blue-950" : "border-border dark:border-gray-700 hover:border-border dark:border-gray-600"}`}
 onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
 onDragLeave={() => setIsDragging(false)}
 onDrop={handleDrop}
 onClick={() => fileInputRef.current?.click()}
 >
 <Upload className={`w-8 h-8 mx-auto mb-2 ${isDragging ? "text-blue-500" : "text-muted-foreground"}`} />
 <p className="text-sm font-medium text-foreground dark:text-muted-foreground">
 {isDragging ? "Drop files here" : "Drag & drop files, or click to browse"}
 </p>
 <p className="text-xs text-muted-foreground mt-1">Supports PDF, images, spreadsheets, and documents</p>
 </div>

 {/* Toolbar */}
 <FilterBar
   search={search}
   onSearch={setSearch}
   placeholder="Search files..."
   filters={
     <Select value={typeFilter} onValueChange={setTypeFilter}>
       <SelectTrigger className="w-28 h-9 border-border dark:border-gray-700 text-sm"><SelectValue /></SelectTrigger>
       <SelectContent>
         <SelectItem value="all">All types</SelectItem>
         <SelectItem value="pdf">PDF</SelectItem>
         <SelectItem value="image">Images</SelectItem>
         <SelectItem value="other">Other</SelectItem>
       </SelectContent>
     </Select>
   }
   actions={<span className="text-sm text-muted-foreground whitespace-nowrap">{filtered.length} files</span>}
 />

 {/* Files list */}
 <SectionCard padding="none">
 {isLoading ? (
 <div className="p-4 space-y-3 animate-pulse">{[...Array(5)].map((_, i) => <div key={i} className="h-12 bg-muted dark:bg-gray-800 rounded-xl" />)}</div>
 ) : filtered.length === 0 ? (
 <EmptyState
   icon={<FileText />}
   title={search ? "No files match your search" : "No documents yet"}
   description={search ? "Try different keywords" : "Upload your first document to get started"}
   action={!search ? { label: "Upload", onClick: () => fileInputRef.current?.click() } : undefined}
   size="lg"
 />
 ) : (
 <div className="divide-y divide-border">
 {filtered.map(doc => (
 <div key={doc.id} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/50 group transition-colors">
 <FileIcon mime={doc.mimeType} />
 <div className="flex-1 min-w-0">
 <p className="text-sm font-medium text-foreground truncate">{doc.name}</p>
 <p className="text-xs text-muted-foreground">
 {fmtSize(doc.size)}{doc.size ? " · " : ""}{formatDistanceToNow(new Date(doc.createdAt), { addSuffix: true })}
 </p>
 </div>
 <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
 {doc.url && (
 <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => window.open(doc.url, "_blank")} title="View">
 <Eye className="w-3.5 h-3.5 text-muted-foreground" />
 </Button>
 )}
 {doc.url && (
 <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => { const a = document.createElement("a"); a.href = doc.url; a.download = doc.name; a.click(); }} title="Download">
 <Download className="w-3.5 h-3.5 text-muted-foreground" />
 </Button>
 )}
 <Button variant="ghost" size="sm" className="h-7 w-7 p-0 hover:text-red-500" onClick={() => { if (confirm(`Delete "${doc.name}"?`)) deleteMutation.mutate(doc.id); }} title="Delete">
 <Trash2 className="w-3.5 h-3.5 text-muted-foreground hover:text-red-500" />
 </Button>
 </div>
 </div>
 ))}
 </div>
 )}
 </SectionCard>
 </PageShell>
 );
}