-- 011: 빵 목록을 DB 로 — 화면 이름·상세 이름·사진
-- 지금까지 화면용 이름과 사진은 코드(lib/bread-market/engine.ts BREADS)에만 있었다.
-- 어드민에서 빵을 추가하려면 DB 가 정본이어야 한다. products.name 은 그대로 몰(Cafe24) 상품명이다
-- (sync-products 가 이 이름으로 Cafe24 상품을 찾는다).

alter table products add column if not exists display_name text;  -- 화면 이름 (예: 휘낭시에)
alter table products add column if not exists full_name    text;  -- 상세 이름 (예: 겉바속쫀 막지 글루텐프리 휘낭시에)
alter table products add column if not exists photo_url    text;  -- 사진 주소. 기존 6종은 /images/..., 새 빵은 Storage 공개 주소

-- 기존 6종: 코드에 있던 값을 옮긴다. 이미 채운 값은 건드리지 않는다.
update products p set
  display_name = coalesce(p.display_name, v.display_name),
  full_name    = coalesce(p.full_name, v.full_name),
  photo_url    = coalesce(p.photo_url, v.photo_url)
from (values
  ('MUF', '비건 잉글리시 머핀', '막지 비건 잉글리시 머핀(햄치즈/비건)',   '/images/bread-market/muf-large.jpg'),
  ('FNC', '휘낭시에',           '겉바속쫀 막지 글루텐프리 휘낭시에',       '/images/bread-market/fnc-large.jpg'),
  ('SCN', '글루텐프리 스콘',    '환상의 단짠 조합, 막지 글루텐프리 스콘',  '/images/bread-market/scn-large.jpg'),
  ('MRL', '모닝롤',             '담백폭신 막지 제로 무설탕 모닝롤',        '/images/bread-market/mrl-large.jpg'),
  ('TTR', '테트리스 브레드',    '폭신한 통식빵, 막지 테트리스 브레드',     '/images/bread-market/ttr-large.jpg'),
  ('GFD', '냉동생지 3종',       '집에서 굽는 막지 글루텐프리 냉동생지 3종', '/images/bread-market/gfd-large.png')
) as v(ticker, display_name, full_name, photo_url)
where p.ticker = v.ticker;

-- 사진 버킷. 공개 읽기(화면이 그대로 <url> 로 쓴다), 쓰기는 서버(service_role)만.
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('bread-photos', 'bread-photos', true, 4194304, array['image/jpeg', 'image/png', 'image/webp'])
    on conflict (id) do update set
      public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
  else
    raise notice 'storage 스키마가 없어 bread-photos 버킷을 만들지 못했습니다. Storage 를 켠 뒤 다시 실행하세요.';
  end if;
end $$;
