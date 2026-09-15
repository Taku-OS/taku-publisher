export type TakuCollectionItem<T = unknown> = {
  collection: string;
  id: string;
  data: T;
  createdAt: string;
  updatedAt: string;
};
