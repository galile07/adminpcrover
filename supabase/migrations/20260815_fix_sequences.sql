-- Realign identity sequences after explicit-id inserts by the admin app
SELECT setval('imported_products_id_seq', GREATEST((SELECT COALESCE(MAX(id), 1) FROM public.imported_products), 1));
SELECT setval('pos_orders_id_seq', GREATEST((SELECT COALESCE(MAX(id), 1) FROM public.pos_orders), 1));
