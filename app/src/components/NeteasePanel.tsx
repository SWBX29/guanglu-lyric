import { useEffect, useRef, useState } from 'react';
import { trpc } from '@/providers/trpc';
import type { NeteasePlaylist, NeteaseSong } from '../../contracts/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  ArrowLeft,
  Crown,
  ListMusic,
  Loader2,
  LogOut,
  Music2,
  Play,
  QrCode,
  RefreshCw,
  Search,
} from 'lucide-react';

function fmtDuration(ms: number) {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/* ---------------- QR 登录 ---------------- */
function QrLogin() {
  const utils = trpc.useUtils();
  const qr = trpc.netease.qrcodeCreate.useQuery(undefined, {
    retry: 1,
    refetchOnWindowFocus: false,
    staleTime: Infinity,
  });
  const key = qr.data?.key ?? '';
  // 轮询要省着用（免费档请求配额）：3s 一次，且最多轮询 60s
  const pollStartRef = useRef(0);
  useEffect(() => {
    pollStartRef.current = Date.now();
  }, [key]);
  const check = trpc.netease.qrcodeCheck.useQuery(
    { key },
    {
      enabled: !!key,
      refetchInterval: (q) => {
        const s = q.state.data?.status;
        if (s === 'success' || s === 'expired') return false;
        if (Date.now() - (pollStartRef.current || Date.now()) > 60_000) return false;
        return 3000;
      },
    },
  );
  const status = check.data?.status;

  useEffect(() => {
    if (status === 'success') {
      void utils.netease.me.invalidate();
      void utils.netease.myPlaylists.invalidate();
    }
  }, [status, utils]);

  // 800 过期 → 自动重新申请二维码
  useEffect(() => {
    if (status === 'expired') {
      const t = window.setTimeout(() => void qr.refetch(), 600);
      return () => window.clearTimeout(t);
    }
  }, [status, qr]);

  const statusText =
    status === 'scanned'
      ? '已扫码，请在手机上确认'
      : status === 'expired'
        ? '二维码已过期，正在刷新…'
        : status === 'success'
          ? '登录成功 ✨'
          : '请用网易云音乐 App 扫码';

  return (
    <div className="flex flex-col items-center gap-3 py-4">
      {qr.isLoading ? (
        <div className="flex h-44 w-44 items-center justify-center rounded-xl border border-white/10 bg-white/5">
          <Loader2 className="h-6 w-6 animate-spin text-white/50" />
        </div>
      ) : qr.isError || !qr.data ? (
        <div className="flex h-44 w-44 flex-col items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5">
          <p className="text-xs text-white/50">二维码加载失败</p>
          <Button
            size="sm"
            variant="outline"
            className="border-white/15 bg-white/5 text-white/80 hover:bg-white/10"
            onClick={() => void qr.refetch()}
          >
            <RefreshCw className="mr-1 h-3.5 w-3.5" /> 重试
          </Button>
        </div>
      ) : (
        <div className="relative">
          <img
            src={qr.data.qrDataUrl}
            alt="网易云登录二维码"
            className={`h-44 w-44 rounded-xl border border-white/10 bg-white p-2 transition ${
              status === 'expired' ? 'opacity-30 grayscale' : ''
            }`}
          />
          {status === 'scanned' && (
            <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-black/60">
              <p className="px-4 text-center text-sm text-amber-100">已扫码<br />请在手机上确认</p>
            </div>
          )}
        </div>
      )}
      <p className="flex items-center gap-1.5 text-xs text-white/55">
        <QrCode className="h-3.5 w-3.5" />
        {statusText}
      </p>
    </div>
  );
}

/* ---------------- 用户信息 ---------------- */
function UserBar() {
  const utils = trpc.useUtils();
  const me = trpc.netease.me.useQuery(undefined, { retry: false, staleTime: 60_000 });
  const logout = trpc.netease.logout.useMutation({
    onSuccess: () => {
      void utils.netease.me.invalidate();
      void utils.netease.myPlaylists.invalidate();
    },
  });
  const u = me.data;
  if (!u?.loggedIn) return null;
  return (
    <div className="flex items-center gap-2.5 rounded-xl border border-white/10 bg-white/5 px-3 py-2">
      {u.avatarUrl ? (
        <img src={u.avatarUrl} alt="" className="h-8 w-8 rounded-full object-cover" />
      ) : (
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-amber-200/20">
          <Music2 className="h-4 w-4 text-amber-100" />
        </div>
      )}
      <span className="min-w-0 flex-1 truncate text-sm text-white/85">{u.nickname ?? '网易云用户'}</span>
      <button
        onClick={() => logout.mutate()}
        disabled={logout.isPending}
        className="flex items-center gap-1 rounded-full border border-white/10 px-2.5 py-1 text-xs text-white/50 transition hover:border-white/25 hover:text-white/85"
      >
        <LogOut className="h-3 w-3" /> 退出
      </button>
    </div>
  );
}

/* ---------------- 歌曲行 ---------------- */
function SongRow({
  song,
  active,
  onPlay,
}: {
  song: NeteaseSong;
  active: boolean;
  onPlay: (s: NeteaseSong) => void;
}) {
  const vip = song.isVip || song.fee === 1;
  return (
    <button
      disabled={vip}
      onClick={() => onPlay(song)}
      title={vip ? 'VIP 歌曲，无法播放' : song.name}
      className={`group flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition ${
        vip
          ? 'cursor-not-allowed opacity-45'
          : active
            ? 'bg-amber-100/15'
            : 'hover:bg-white/8'
      }`}
    >
      {song.cover ? (
        <img src={song.cover} alt="" className="h-10 w-10 shrink-0 rounded-lg object-cover" />
      ) : (
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white/10">
          <Music2 className="h-4 w-4 text-white/50" />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className={`truncate text-sm ${active ? 'text-amber-100' : 'text-white/90'}`}>
            {song.name}
          </span>
          {vip && (
            <span className="flex shrink-0 items-center gap-0.5 rounded-full border border-amber-300/40 bg-amber-300/10 px-1.5 py-px text-[10px] text-amber-200">
              <Crown className="h-2.5 w-2.5" /> VIP
            </span>
          )}
        </div>
        <div className="truncate text-xs text-white/45">
          {song.artists} · {song.album}
        </div>
      </div>
      {vip ? (
        <span className="shrink-0 text-[10px] text-white/40">VIP 歌曲，无法播放</span>
      ) : (
        <span className="flex shrink-0 items-center gap-1 text-xs text-white/40">
          {fmtDuration(song.duration)}
          <Play className="h-3.5 w-3.5 opacity-0 transition group-hover:opacity-100" />
        </span>
      )}
    </button>
  );
}

/* ---------------- 搜索 ---------------- */
function SearchTab({ activeId, onPlay }: { activeId?: number; onPlay: (s: NeteaseSong) => void }) {
  const [draft, setDraft] = useState('');
  const [keyword, setKeyword] = useState('');
  const search = trpc.netease.searchSongs.useQuery(
    { keyword, limit: 30 },
    { enabled: keyword.trim().length > 0, retry: 1, refetchOnWindowFocus: false },
  );
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (draft.trim()) setKeyword(draft.trim());
        }}
      >
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="搜索歌曲 / 歌手…"
          className="h-9 border-white/15 bg-white/5 text-sm text-white/85 placeholder:text-white/30 focus-visible:ring-amber-200/30"
        />
        <Button
          type="submit"
          size="sm"
          variant="outline"
          className="h-9 shrink-0 border-white/15 bg-white/5 text-white/80 hover:bg-white/10"
        >
          <Search className="h-4 w-4" />
        </Button>
      </form>
      <div className="min-h-0 flex-1 overflow-y-auto pr-0.5 [scrollbar-width:thin]">
        {search.isFetching && (
          <p className="flex items-center justify-center gap-2 py-6 text-xs text-white/40">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> 搜索中…
          </p>
        )}
        {search.isError && <p className="py-6 text-center text-xs text-white/40">搜索失败，请稍后重试</p>}
        {search.data && !search.isFetching && search.data.length === 0 && (
          <p className="py-6 text-center text-xs text-white/40">没有找到相关歌曲</p>
        )}
        {search.data?.map((s) => (
          <SongRow key={s.id} song={s} active={s.id === activeId} onPlay={onPlay} />
        ))}
        {!keyword && (
          <p className="py-6 text-center text-xs text-white/30">输入关键词，搜一首想听的歌</p>
        )}
      </div>
    </div>
  );
}

/* ---------------- 歌单（两级导航） ---------------- */
function PlaylistTab({ activeId, onPlay }: { activeId?: number; onPlay: (s: NeteaseSong) => void }) {
  const [open, setOpen] = useState<NeteasePlaylist | null>(null);
  const me = trpc.netease.me.useQuery(undefined, { retry: false, staleTime: 60_000 });
  const loggedIn = !!me.data?.loggedIn;
  const playlists = trpc.netease.myPlaylists.useQuery(undefined, {
    enabled: loggedIn,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const tracks = trpc.netease.playlistTracks.useQuery(
    { playlistId: open?.id ?? 0 },
    { enabled: !!open, retry: 1, refetchOnWindowFocus: false },
  );

  if (!loggedIn) {
    return <p className="py-8 text-center text-xs text-white/35">扫码登录后，这里会显示你的网易云歌单</p>;
  }

  if (open) {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-2">
        <button
          onClick={() => setOpen(null)}
          className="flex w-fit items-center gap-1 rounded-full border border-white/10 px-2.5 py-1 text-xs text-white/55 transition hover:text-white/90"
        >
          <ArrowLeft className="h-3 w-3" /> 返回歌单
        </button>
        <p className="truncate px-1 text-sm text-white/80">{open.name}</p>
        <div className="min-h-0 flex-1 overflow-y-auto pr-0.5 [scrollbar-width:thin]">
          {tracks.isLoading && (
            <p className="flex items-center justify-center gap-2 py-6 text-xs text-white/40">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> 加载歌曲…
            </p>
          )}
          {tracks.isError && <p className="py-6 text-center text-xs text-white/40">歌单加载失败</p>}
          {tracks.data?.map((s) => (
            <SongRow key={s.id} song={s} active={s.id === activeId} onPlay={onPlay} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto pr-0.5 [scrollbar-width:thin]">
      {playlists.isLoading && (
        <p className="flex items-center justify-center gap-2 py-6 text-xs text-white/40">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> 加载歌单…
        </p>
      )}
      {playlists.isError && <p className="py-6 text-center text-xs text-white/40">歌单加载失败</p>}
      {playlists.data?.length === 0 && <p className="py-6 text-center text-xs text-white/40">暂无歌单</p>}
      {playlists.data?.map((p) => (
        <button
          key={p.id}
          onClick={() => setOpen(p)}
          className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition hover:bg-white/8"
        >
          {p.cover ? (
            <img src={p.cover} alt="" className="h-10 w-10 shrink-0 rounded-lg object-cover" />
          ) : (
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white/10">
              <ListMusic className="h-4 w-4 text-white/50" />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm text-white/90">{p.name}</div>
            <div className="truncate text-xs text-white/45">
              {p.trackCount} 首 · by {p.creator}
            </div>
          </div>
        </button>
      ))}
    </div>
  );
}

/* ---------------- 面板主体 ---------------- */
export function NeteasePanel({
  activeSongId,
  onPlay,
}: {
  activeSongId?: number;
  onPlay: (s: NeteaseSong) => void;
}) {
  const me = trpc.netease.me.useQuery(undefined, { retry: false, staleTime: 60_000 });
  const loggedIn = !!me.data?.loggedIn;
  const panelRef = useRef<HTMLDivElement>(null);

  return (
    <div
      ref={panelRef}
      className="pointer-events-auto flex h-full min-h-0 w-full flex-col gap-3 overflow-hidden rounded-2xl border border-white/10 bg-black/60 p-4 shadow-2xl backdrop-blur-xl"
    >
      <div className="flex items-center gap-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-red-500/20">
          <Music2 className="h-4 w-4 text-red-300" />
        </div>
        <h2 className="font-serif-sc text-base tracking-widest text-white/90">网易云音乐</h2>
      </div>

      {loggedIn ? <UserBar /> : <QrLogin />}

      <Tabs defaultValue="search" className="flex min-h-0 flex-1 flex-col">
        <TabsList className="grid w-full grid-cols-2 border border-white/10 bg-white/5">
          <TabsTrigger value="search" className="text-xs data-[state=active]:bg-amber-100/15 data-[state=active]:text-amber-100">
            搜索
          </TabsTrigger>
          <TabsTrigger value="playlists" className="text-xs data-[state=active]:bg-amber-100/15 data-[state=active]:text-amber-100">
            我的歌单
          </TabsTrigger>
        </TabsList>
        <TabsContent value="search" className="mt-3 flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden">
          <SearchTab activeId={activeSongId} onPlay={onPlay} />
        </TabsContent>
        <TabsContent value="playlists" className="mt-3 flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden">
          <PlaylistTab activeId={activeSongId} onPlay={onPlay} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
