# Odin Book Backend server

This is an express backend server for the [Odin-Book Project](https://www.theodinproject.com/lessons/node-path-nodejs-odin-book) from [The Odin Project](https://www.theodinproject.com). It uses the following technologies:

- Typescript
- Express
- Cloudinary
- Prisma
- Postgres
- Passportjs

This ReadMe will provide a general outline of all the endpoints and what each one does. To see the Frontend for this project please see [odin-book-fe](https://github.com/vulpes-walter1313/odin-book-fe).

## Endpoints

- `POST /auth/signin`
- `POST /auth/signup`
- `POST /auth/refresh`
- `GET /auth/check`
- `GET /auth/google`
- `GET /auth/google/callback`
- `GET /posts`
- `POST /posts`
- `GET /posts/:postId`
- `PUT /posts/:postId`
- `DELETE /posts/:postId`
- `POST /posts:postId/likes`
- `DELETE /posts:postId/likes`
- `GET /posts/:postId/comments`
- `POST /posts/:postId/comments`
- `PUT /posts/:postId/comments/:commentId`
- `DELETE /posts/:postId/comments/:commentId`
- `POST /posts/:postId/comments/:commentId/like`
- `DELETE /posts/:postId/comments/:commentId/like`
- `GET /profiles`
- `GET /profiles/:username`
- `POST /profiles/:username/follow` (follow user)
- `DELETE /profiles/:username/follow` (unfollow user)
- `GET /profiles/:username/followers`
- `GET /profiles/:username/following`
- `GET /account/user`
- `PUT /account/user`
- `DELETE /account/user`
- `PUT /account/password`
- `PUT /account/username`
- `POST /admin/users/ban`
- `DELETE /admin/users/ban`
- `DELETE /admin/users/:username`

## Server Error Response

Before we go in detail into the endpoints, it's important to mention that all these endpoints can either return a custom successful JSON response, or a standardized error. The client will be able to get these error responses from the server and interpret them to make decisions on the frontend.

```JSON
{
  "success": false,
  "error": {
    "code": "UNAUTHORIZED",
    "message": "some message",
    "details": {
      "property": "value"
    }
  }
}
```

Validation errors can look a bit different, like so

```JSON
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "you have one or more validation errors"
  },
  "validationErrors": {
    "email": {
      "type": "field",
      "value": "curios123",
      "msg": "Invalid value",
      "path": "email",
      "location": "body"
    },
    "password": {
      "type": "field",
      "value": "",
      "msg": "Invalid value",
      "path": "password",
      "location": "body"
    }
  }
}
```

### `POST /auth/signin`

Route will login the user with passport-local strategy. It expects the following JSON body:

```JSON
{
  "email": "email@email.com",
  "password": "password"
}
```

The response will be either an error or this response on success:

```JSON
{
  "accessToken": "<access token>",
  "refreshToken": "<refresh token>"
}
```

### `POST /auth/signup`

Route will sign up user with passportjs. It expects the following JSON body:

```JSON
{
  "name": "John Doe",
  "username": "jdoe05",
  "email": "jdoe@email.com",
  "password": "<password>",
  "confirmPassword": "<password>"
}
```

the response will either be a standard error or this successful response:

```JSON
{
  "accessToken": "<access token>",
  "refreshToken": "<refresh token>"
}
```

### `POST /auth/logout`

Route will logout the currently logged in user out of the current session or all sessions depending on the request body.

```JSON
{
  "allSessions": true,
  "refreshToken": "cfo20i8a4lmqzw4bgnvq7wpp"
}
```

The response will either be a standard error or this successful response:

```JSON
{
  "message": "Logged out of all 4 devices successfully"
}
```

### `POST /auth/refresh`

This endpoint is used periodically by clients to get a new accessToken and refreshToken.

It expects the following request JSON body:

```JSON
{
  "refreshToken": "<refresh token"
}
```

The response will either be a standard error or the following success response:

```JSON
{
  "accessToken": "<access token>",
  "refreshToken": "<refresh token>"
}
```

### `GET /auth/check`

This endpoint is for the FE client to call and check the current auth status of the logged in user.

The response will either be a standard error or the following success response:

```JSON
{
  "message": "<message>",
  "username": "<username>",
  "name": "<name>",
  "profileImg": "<image url>",
  "isAdmin": false
}
```

### `GET /auth/google`

This is the first endpoint hit for Google Oauth.

### `GET /auth/google/callback`

This is the second endpoint hit for Google Oauth. It the auth is successful, there is another middleware that is triggered, which creates an accessToken and refreshToken and sends a browser redirect to `${FE_URL}/oauth-success?accessToken=${accessToken}&refreshToken=${refreshToken}`

### `GET /posts`

Query Params:

- feed:
  - personal
  - explore
  - user
- sort:
  - popular
  - latest
  - oldest
- username (unique username)
- page

This route will be the infinite scroll endpoint to fetch many post in the specific feed asked for. The feed can be "personal" which only shows posts from people you follow and your own posts, "explore" which shows all users posts, and "user", which only fetches post from a specific user which requires an additional query param of "username" that has the id of that specific user.

The response will either be a standard error or this success response:

```JSON
{
  "posts": [
    {
      "id": 1,
      "_count": {
        "userLikes": 20,
        "comments": 43
      },
      "caption": "<post caption>",
      "imageUrl": "<image url>",
      "createdAt": "<ISO timestamp>",
      "updatedAt": "<ISO timestamp>",
      "imageWidth": 1000,
      "imageHeight": 1000,
      "author": {
        "id": "<author id>",
        "name": "<name>",
        "username": "<username>",
        "profileImg": "<image url>"
      },
      "likedByUser": true
    }
  ],
  "currentPage": 1,
  "totalPages": 22
}
```

#### Example Requests

- `http://localhost:3000/posts?feed=personal&sort=popular&page=1`
- `http://localhost:3000/posts?feed=username&username=jdoe87&sort=popular&page=1`

### `POST /posts`

This endpoint allows for the creation of a post. The current user is taken from the `req.user` populated from passportjs jwt strategy.

This endpoint expects the following formData body:

- image (File object, single image)
- caption (min: 1 char, max: 2048 char)

The response will either be a standard error or a success response:

```JSON
{
  "message": "post created successfully"
}
```

### `GET /posts/:postId`

Gets the post data from `:postId` including:

- id
- caption
- imageUrl?
- imageWidth
- imageHeight
- createdAt
- updatedAt
- Author
  - id
  - name
  - username
  - profileImg? (to display an avatar)
- Number of comments
- Number of likes
- boolean for if logged in user likes the post
- boolean for is the logged in user is the author of the post

the actual comments can be grabbed by a different endpoint `/posts/:postId/comments`

The response will either be a standard error or the following success response:

```JSON
{
  "post": {
    "id": 22,
    "caption": "<caption>",
    "imageUrl": "<img url>",
    "imageWidth": 1000,
    "imageHeight": 1000,
    "createdAt": "<ISO Timestamp>",
    "updatedAt": "<ISO Timestamp>",
    "author": {
      "id": "<author id>",
      "name": "<name>",
      "username": "<username>",
      "profileImg": "<img url>"
    },
    "_count": {
      "userLikes": 100,
      "comments": 23
    },
    "likedByUser": true,
    "userIsAuthor": false
  }
}
```

### `PUT /posts/:postId`

This route will update the post and can only be used by admin and the post author.

This endpoint expects the following formData body:

- image (File object, single image)
- caption (min: 1 char, max: 2048 char)

the response will either be a standard error or this successful response:

```JSON
{
  "message": "Post updated successfully",
  "postId": 26
}
```

### `DELETE /posts/:postId`

This endpoint can only delete the post in question if user is admin or post author.

The response will either be a standard error or this successful response:

```JSON
{
  "message": "Post deleted successfully"
}
```

### `POST /posts/:postId/likes`

This endpoint is the record the current logged in user liking the post in question

```JSON
{
  "message": "post liked"
}
```

### `DELETE /posts/:postId/likes`

This endpoint unlikes a post.

```JSON
{
  "message": "post unliked"
}
```

### `GET /posts/:postId/comments`

This endpoint will fetch comments from the post in question. I am considering to eventually be able to sort comments by popular, but for now, we can just sort by createdAt descending. so from latest to oldest. There is a hard limit of 15 comments per page.

**Query Params**

- page

The response will be either a standard error or this sucessful response:

**Comments Data**

- id
- createdAt
- updateAt
- message
- postId
- author
  - id
  - name
  - propfileImg
- \_count
  - userLikes
- userLikedComment (boolean)
- userIsAuthor (boolean)

```JSON
{
  "comments": [
    {
      "id": 1,
      "createdAt": "<ISO Timestamp>",
      "updatedAt": "<ISO Timestamp>",
      "message": "<comment message>",
      "postId": 123,
      "author": {
        "id": "<author id>",
        "name": "<name>",
        "profileImg": "<image url>",
      },
      "_count": {
        "userLikes": 3
      },
      "userLikedComment": true,
      "userIsAuthor": false
    }
  ],
  "totalPages": 20,
  "currentPage": 1
}
```

### `POST /posts/:postId/comments`

This endpoint will allow users to post a comment on a specific post.

This is the expected request JSON body:

```JSON
{
  "message": "<message>"
}
```

The comment should be between 1 and 2048 characters.

The response will be either a standard error or this successful response:

```JSON
{
  "message": "Comment created",
  "comment": {
    "id": 123,
    "message": "<message>",
    "createdAt": "<ISO Timestamp>",
    "updatedAt": "<ISO Timestamp>",
    "authorId": "<author id>",
    "postId": 33
  }
}
```

#### Example Request body

```JSON
{
  "message": "that is a really cool post"
}
```

### `PUT /posts/:postId/comments/:commentId`

This endpoint allows the admin or the comment author to edit their comment message. The endpoint expects the following JSON body:

```JSON
{
  "message": "<comment message>"
}
```

The message should be between 1 - 2048 characters.

### `DELETE /posts/:postId/comments/:commentId`

This endpoint allows the comment author or the admin to delete the comment. there is no expected body in the request.

The response will be either a standard error or the following successful response:

```JSON
{
  "message": "Successfully deleted comment"
}
```

### `POST /posts/:postId/comments/:commentId/like`

This endpoint reflects a like to a comment by the logged in user. The user logged in is reflected in the JWT sent in the Authorization header. There is no expected request body.

The response will either be a standard error or the following successful response:

```JSON
{
  "message": "Comment Liked successfully"
}
```

### `DELETE /posts/:postId/comments/:commentId/like`

This endpoint reflects when a logged in user unliked a comment they had previously liked

The response will either be a standard error or the following successful response:

```JSON
{
  "message": "Comment Unliked successfully"
}
```

### `GET /profiles`

This will be like a directory to find new users to follow. This endpoint is paginated with a hard limit of 25 profiles per page. There is an optional search feature where you can search for a specific user by username. Default sort is by followers count then sorted by name.

The response will be either a standard error or the following success response:

```JSON
{
  "users": [
    {
      "id": "<user id>",
      "name": "<user name>",
      "username": "<username>",
      "bio": "<user bio>",
      "profileImg": "<image url>",
      "_count": {
        "followedBy": 20
      },
      "areFollowing": true
    }
  ],
  "currentPage": 1,
  "totalPages": 20
}
```

### `GET /profiles/:username`

This endpoint fetches the profile data of the user in question.

**Data you get:**

- user id: string
- user's display name: string
- username: string
- bannedUntil: ISO Date - string
- bio: string
- profileImg: string
- \_count:
  - posts
  - followers
  - following
- areFollowing: boolean

This is not to update your account settings, this is to view a user's profile. To fetch the user's post, you would use the `/posts?feed=user&username=<username>`. The usernames are unique so this should be just as good as the user's id.

The response will either be a standard error or the following successfull response:

```JSON
{
  "user": {
    "id": "<user id>",
    "name": "<user's display name>",
    "username": "<username>",
    "bannedUntil": "<ISO Date string>",
    "bio": "<user's bio>",
    "profileImg": "<image url>",
    "_count": {
      "posts": 294,
      "followedBy": 123,
      "following": 321
    },
    "areFollowing": false
  }
}
```

### `POST /profiles/:username/follow`

This endpoint allows logged in user to follow the user in question. There is no expected request body.

The response will either be a standard error or the following success response:

```JSON
{
  "message": "successfully following <username>"
}
```

### `DELETE /profiles/:username/follow`

This endpoint allows logged in user to unfollow the user in question. There is no expected request body.

The response will either be a standard error or the following success response:

```JSON
{
  "message": "Successfully unfollowed <username>"
}
```

### `GET /profiles/:username/following`

This endpoint gets a list of users that :username is following. Results are sorted by follower count descending and then by id asceding

**Query params required:**

- page
- limit (must be 10-50)

**Params:**

- username: between 3-32 inclusive characters long

The response will either be a standard error or the following successful response:

```JSON
{
  "users": [
    {
      "id": "<user id>",
      "name": "<user display name>",
      "username": "<username>",
      "bio": "<user bio>",
      "profileImg": "<image url>",
      "_count": {
        "followedBy": 123,
        "following": 321
      },
      "areFollowing": true
    }
  ],
  "currentPage": 1,
  "totalPages": 123
}
```

### `GET /profiles/:username/followers`

This gets a list of users that :username is followed by. Results are sorted by follower count descending and then by id asceding.

**Query params required:**

- page
- limit (must be 10-50)

**Params:**

- username: between 3-32 inclusive characters long

The response will either be a standard error or the following successful response:

```JSON
{
  "users": [
    {
      "id": "<user id>",
      "name": "<user display name>",
      "username": "<username>",
      "bio": "<user bio>",
      "profileImg": "<image url>",
      "_count": {
        "followedBy": 123,
        "following": 321
      },
      "areFollowing": true
    }
  ],
  "currentPage": 1,
  "totalPages": 123
}
```

### `GET /account/user`

This endpoint fetches the logged in user's account data. Most of this is created during signup, and can be edited later in the next endpoint.

The response can either be a standard error or this successful response:

```JSON
{
  "user": {
    "id": "<user id>",
    "name": "<user's display name>",
    "username": "<username>",
    "bio": "<user's bio>",
    "profileImg": "<image url>"
  },
  "hasCredentialsAccount": true
}
```

### `PUT /account/user`

This endpoint updates the following user's account data:

- profile image
- name
- bio

This endpoint expects the following FormData body:

- profileImg: File
- name: string (max:48)
- bio?: string (max:512)

The response can be either a standard error or the following successful response:

```JSON
{
  "message": "<message>"
}
```

### `PUT /account/password`

This endpoint updates the users password by asking for the old password, a new password, and confirming the new password. The user must have an account with a "Credentials" provider. If the users account does not have a credentials provider the the endpoint will return a standard error response.

This is the expected JSON request body:

```JSON
{
  "oldPassword": "<old password>",
  "newPassword": "<new password>",
  "confirmNewPassword": "<new password>"
}
```

The response will either be a standard error or the following successful response:

```JSON
{
  "message": "Password updated"
}
```

### `PUT /account/username`

This endpoint changes a logged in user's username. All usernames must be between 3 and 32 characters inclusive. It expects the following JSON request body:

```JSON
{
  "newUsername": "<new username>"
}
```

The following conditions can cause a standard error to be returned as a response:

- Logged in user (from JWT) not found
- new username already taken

A successful response will look like the following:

```JSON
{
  "message": "Username successfully updated"
}
```

### `DELETE /account/user`

This permanently deletes the account. Posts and comments will also get deleted. This endpoint expects a confirmation for deletion in the request body as JSON:

```JSON
{
  "confirm": "delete my account"
}
```

The delete confirmation phrase is hardcoded as "delete my account", i wanted to use password confirmation but since some user accounts are from Google, i choose to make the confirmation phrase the same for all users. The front end should use an ajax request with a user submitted confirmation phrase. This is just an added step to ensure they really want to delete their account.

The successful response will look like the following:

```JSON
{
  "message": "Account successfully deleted",
  "username": "<username>",
  "id": "<id of user deleted>"
}
```

### `POST /admin/users/ban`

This is an admin route, that allows admin to ban users for a specified time. This endpoint expects the following request JSON body:

```JSON
{
  "username": "<username>",
  "banUntil": "<ISO8601 date string>"
}
```

The response can be either a standard error or the following successful response:

```JSON
{
  "message": "Ban user to be implemented",
  "username": "<username>",
  "bannedUntil": "<ISO Date>"
}
```

### `DELETE /admin/users/ban`

This is an admin route, that allows admin to remove a ban. This endpoint expects a JSON request body like the following:

```JSON
{
  "username": "<username>"
}
```

The response will be either a standard error or the following successful response:

```JSON
{
  "message": "User unbanned successfully",
  "username": "<unbanned user's username>"
}
```

### `DELETE /admin/users/:username`

This is an admin route that allows admins to delete users. there is no expected request body, just hit the api with the correct username param.

The response can be either a standard error or the following success response:

```JSON
{
  "message": "User successfully deleted",
  "username": "<username>",
  "userId": "<deleted user's id>"
}
```
