import { MAX_OPS_PER_MUTATION, type ProjectModel } from '@erdd/core'
import { buildSampleModel } from '@erdd/core/src/testing/fixtures.js'

/**
 * 테스트용: 삭제 op 총수가 상한을 넘는 모델. 테이블 수는 그대로 두고 컬럼만 붙인다.
 *
 * 여기 두는 이유: op 상한 가드는 `BulkDeleteDialog` 안에 있고 **툴바와 일괄 패널이 그 다이얼로그를
 * 공유한다**. 두 진입점의 테스트가 같은 픽스처를 봐야 가드 경계를 옮길 때 한쪽만 고쳐지지 않는다.
 */
export function modelOverOpCap(): ProjectModel {
  const m = buildSampleModel()
  for (let i = 0; i < MAX_OPS_PER_MUTATION; i++) {
    const id = `bulk-c${i}`
    m.columns[id] = {
      id, tableId: 't1', logicalName: `컬럼${i}`, physicalName: `COL_${i}`,
      type: 'VARCHAR(10)', isPk: false, autoIncrement: false, nullable: true,
      defaultValue: null, order: i + 1, comment: null, domainId: null, custom: {},
    }
  }
  return m
}
