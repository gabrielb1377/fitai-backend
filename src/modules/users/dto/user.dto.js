const PROFILE_SELECT = {
  id: true,
  userId: true,
  weight: true,
  height: true,
  age: true,
  goal: true,
  level: true,
  createdAt: true,
  updatedAt: true
};

const USER_SELECT = {
  id: true,
  name: true,
  email: true,
  createdAt: true,
  updatedAt: true,
  profile: {
    select: PROFILE_SELECT
  }
};

function toUserDto(user) {
  if (!user) {
    return null;
  }

  const { passwordHash, ...safeUser } = user;

  return safeUser;
}

function toUsersDto(users) {
  return users.map(toUserDto);
}

module.exports = {
  PROFILE_SELECT,
  USER_SELECT,
  toUserDto,
  toUsersDto
};
