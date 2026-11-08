"""시연용 가짜 프로필. 실제 내용은 personas.py 에 있고, 여기는 예전 이름(seed_demo)을 그대로 쓸 수 있게 이어 줍니다.

사용자 1번 = 데모용 국내 학생(수아), 17번 = 데모용 유학생(하루카). 실제 학생 정보는 하나도 없습니다.
"""
from sqlalchemy.orm import Session

from .personas import seed_personas


def seed_demo(db: Session, seed: int = 7) -> None:  # seed 인자는 예전 호출과 맞추려고 남겨 둔 것(내용은 고정)
    seed_personas(db)
