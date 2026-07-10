-- 0008: 头像存储桶 avatars —— 公开读、仅本人文件夹可写
-- 路径约定：{user_id}/{timestamp}.{ext}，第一层文件夹名即 user_id，策略据此限定归属。
-- 注意：Supabase 匿名登录用户同属 authenticated 角色，策略层不区分匿名；
--       前端在上传入口处阻止匿名用户（见 AvatarModal），此处按约定实现。

-- 建桶（public 读；幂等）
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

-- 公开读：任何人可读取 avatars 桶内对象（头像 URL 直接外链）
create policy "avatars_public_read" on storage.objects
  for select
  using (bucket_id = 'avatars');

-- 本人文件夹可写：insert / update / delete 仅限 {auth.uid()}/ 前缀下的对象
create policy "avatars_owner_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "avatars_owner_update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "avatars_owner_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
