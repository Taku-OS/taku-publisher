// Drizzle ORM 使用示例

import { eq } from 'drizzle-orm';
import { getDb } from './index';
import { type NewPost, type NewUser, type Post, posts, type User, users } from './schema';

// 用户操作示例
export async function createUser(userData: Omit<NewUser, 'createdAt'>): Promise<User> {
  const db = getDb();
  const [newUser] = await db.insert(users).values(userData).returning();
  return newUser;
}

export async function getUserById(id: number): Promise<User | undefined> {
  const db = getDb();
  return await db.select().from(users).where(eq(users.id, id)).get();
}

export async function getAllUsers(): Promise<User[]> {
  const db = getDb();
  return await db.select().from(users).all();
}

export async function updateUser(id: number, data: Partial<NewUser>): Promise<User | undefined> {
  const db = getDb();
  const [updatedUser] = await db.update(users).set(data).where(eq(users.id, id)).returning();
  return updatedUser;
}

export async function deleteUser(id: number): Promise<void> {
  const db = getDb();
  await db.delete(users).where(eq(users.id, id));
}

// 文章操作示例
export async function createPost(postData: Omit<NewPost, 'createdAt'>): Promise<Post> {
  const db = getDb();
  const [newPost] = await db.insert(posts).values(postData).returning();
  return newPost;
}

export async function getPostsByUser(userId: number): Promise<Post[]> {
  const db = getDb();
  return await db.select().from(posts).where(eq(posts.authorId, userId)).all();
}

// 联合查询示例
export async function getUsersWithPosts() {
  const db = getDb();
  return await db
    .select({
      user: users,
      post: posts,
    })
    .from(users)
    .leftJoin(posts, eq(users.id, posts.authorId))
    .all();
}

// 事务示例
export async function createUserWithPost(
  userData: Omit<NewUser, 'createdAt'>,
  postData: Omit<NewPost, 'authorId' | 'createdAt'>
) {
  const db = getDb();
  return await db.transaction(async (tx) => {
    const [user] = await tx.insert(users).values(userData).returning();
    const [post] = await tx
      .insert(posts)
      .values({
        ...postData,
        authorId: user.id,
      })
      .returning();

    return { user, post };
  });
}
