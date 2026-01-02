import db from "../db/db.ts";
import { faker } from "@faker-js/faker";
import bcrypt from "bcryptjs";

async function main() {
  // TODO: create 5 users

  const userPromises = Array.from({ length: 5 }).map(async () => {
    const hash = await bcrypt.hash("pass1234", 10);
    const user = {
      name: faker.person.fullName().slice(0, 47),
      email: faker.internet.email(),
      username: faker.internet.username().slice(0, 31),
      password: hash,
    };
    return user;
  });
  const users = await Promise.all(userPromises);
  console.log("creating users");
  const newUsers = await db.user.createManyAndReturn({ data: users });
  console.log("user creation finished");

  // TODO: create 5 post per user
  const imgUrl =
    "https://fastly.picsum.photos/id/123/1000/1000.jpg?hmac=L70JipYXLoNmJdiuoc-8FRvag9scbWWmGHapHL0gJMM";
  const allPosts: {
    caption: string;
    imageUrl: string;
    authorId: string;
    imageWidth: number;
    imageHeight: number;
  }[] = [];

  for (let user of newUsers) {
    const usersPosts = Array.from({ length: 5 }).map(() => {
      const post = {
        caption: faker.lorem.paragraph({ min: 3, max: 5 }),
        imageUrl: imgUrl,
        authorId: user.id,
        imageWidth: 1000,
        imageHeight: 1000,
      };
      return post;
    });
    usersPosts.forEach((post) => {
      allPosts.push(post);
    });
  }

  console.log("creating posts...");
  const newPosts = await db.post.createManyAndReturn({
    data: allPosts,
  });
  console.log("post creation finished");

  // TODO: Create 5 comments per post
  const allComments: {
    authorId: string;
    message: string;
    postId: number;
  }[] = [];

  newPosts.forEach((post) => {
    const comments = newUsers.map((user) => {
      const comment = {
        authorId: user.id,
        message: faker.lorem.paragraph({ min: 1, max: 3 }),
        postId: post.id,
      };
      return comment;
    });
    comments.forEach((comment) => {
      allComments.push(comment);
    });
  });

  console.log("creating comments...");
  await db.comment.createMany({
    data: allComments,
  });
  console.log("comment creation finished.");
}

try {
  main();
} catch (err) {
  console.error(err);
} finally {
  db.$disconnect();
}
